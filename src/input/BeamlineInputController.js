// src/input/BeamlineInputController.js
//
// All beamline-related input: junction placement ghost, pipe drawing,
// placement-on-pipe ghost. Translates cursor events into BeamlineSystem
// calls. Owned by InputHandler; BeamlineTool (src/input/beamline-tool.js)
// routes events here whenever a beamline component tool is armed, passing
// the armed component key explicitly — the controller holds no tool
// selection of its own.
//
// The controller is also the single owner of the pipe-draw render state:
// ThreeRenderer's animate loop reads `isActive()`, `drawPath`, `drawMode`,
// `drawCost`, `hoverPoint` and `hoverOpenEnd` straight off this object (no
// mirrored InputHandler fields).

import { COMPONENTS } from '../data/components.js';
import { PLACEABLES } from '../data/placeables/index.js';
import {
  snapForPlaceable, previewPlacement, canAffordCost, componentCostFor, PLACE_UNAFFORDABLE,
} from '../game/placement.js';
import { DIR_DELTA } from '../data/directions.js';
import { availablePorts, portWorldPosition, portSide } from '../beamline/junctions.js';
import {
  BEAM_PIPE_Y,
  snapPipePoint,
  buildStraightPath,
  findNearestPipeToWorld,
  positionToPoint,
} from '../beamline/pipe-geometry.js';
import {
  findSlot, placementsConflict, quantizePlacementPosition,
} from '../beamline/pipe-placements.js';
import { isoToGridFloat } from '../renderer/grid.js';

// Hit-test radius (pipe-path units) for snapping the pipe-draw cursor to a
// junction port or an existing pipe's open end. 1 unit = half a tile in
// path-space (since pipe paths use *2+1 indexing), so 0.5 covers roughly
// half a tile — generous enough that the user rarely misses but tight
// enough to avoid bleeding into adjacent sub-cells on dense layouts.
const PIPE_SNAP_RADIUS = 0.5;
// Visible beam flanges are hand-eye targets, so use a fixed viewport budget
// when the renderer can project them. This stays forgiving across zoom levels
// and avoids asking the player to click the flange's ground-plane shadow.
const PIPE_SNAP_RADIUS_PX = 42;
// Sources are the start of the most common pipe gesture and their body can
// visually crowd the small exit flange. Give source beam ports a larger
// magnetic target without widening every junction in a dense beamline.
const SOURCE_PIPE_SNAP_RADIUS_PX = 64;
// Tolerance for matching a pipe path point during right-click-drag removal.
// Matches the value used in the legacy InputHandler flow.
const PIPE_REMOVE_EPS = 0.13;

export class BeamlineInputController {
  constructor({ game, renderer, inputHandler }) {
    this.game = game;
    this.renderer = renderer;
    // Back-reference for shared non-tool input state (placementDir,
    // selectedParamOverrides, lastMouseWorld). Tool selection itself is
    // passed into each handler by BeamlineTool.
    this.input = inputHandler;

    // Pipe-draw state. While _drawing === true, BeamlineTool routes
    // mousemove/mouseup here and skips its other paths.
    this._drawing = false;
    this._drawMode = 'add';           // 'add' | 'remove'
    this._drawButton = null;          // mouse button that armed the gesture
    this._drawPrimed = false;         // source ghost follows hover until next press
    this._drawPath = [];              // [{col,row}] — current preview path
    this._drawOrigin = null;          // snapped start point
    this._drawStartAnchor = null;     // null | { kind:'port', junctionId, portName }
                                       //        | { kind:'openEnd', pipeId, openEnd:'start'|'end' }

    // Pre-click hover marker for the pipe-draw tool (renderer-read).
    this._hoverPoint = null;          // {col,row} in pipe-path space
    this._hoverOpenEnd = null;        // { pipeId, openEnd } when snapped to a cap
    this._hoverValidAnchor = false;   // true when a click here would start a draw
    this._guidedPath = null;          // two-point starter stub from Build Forward

    // Last valid placement-on-pipe preview, set by _previewPlacement and
    // consumed by onMouseDown. Null when no pipe is under the cursor or the
    // dry-run findSlot rejects the current mode.
    this._placementHover = null;
  }

  // --- renderer-read state ---------------------------------------------

  get drawPath() { return this._drawPath; }
  get drawMode() { return this._drawMode; }
  get drawCost() { return this._drawing ? this._previewCost() : null; }
  get hoverPoint() { return this._hoverPoint; }
  get hoverOpenEnd() { return this._hoverOpenEnd; }
  get hoverValidAnchor() { return this._hoverValidAnchor; }
  get guidedPath() { return this._guidedPath; }

  clearHover() {
    this._hoverPoint = null;
    this._hoverOpenEnd = null;
    this._hoverValidAnchor = false;
    this._guidedPath = null;
  }

  /**
   * Prime a draggable pipe ghost on a newly placed source. The ghost follows
   * the pointer immediately; the next left press/release commits it. Keeping
   * the primed state distinct prevents the release that placed the source (or
   * dismissed its mission picker) from accidentally buying the starter pipe.
   */
  showGuidedPipeStart(junctionId, portName = 'exit') {
    const placeable = this._findPlaceable(junctionId);
    const pos = placeable && portWorldPosition(placeable, portName);
    const beamPipes = this.game.state?.beamPipes || [];
    if (!placeable || !pos || !availablePorts(placeable, beamPipes).includes(portName)) {
      return false;
    }
    const origin = { col: (pos.x - 1) / 2, row: (pos.z - 1) / 2 };
    const side = portSide(placeable, portName);
    const delta = side === 'N' ? { col: 0, row: -0.5 }
      : side === 'S' ? { col: 0, row: 0.5 }
      : side === 'E' ? { col: 0.5, row: 0 }
      : { col: -0.5, row: 0 };
    this._drawing = true;
    this._drawMode = 'add';
    this._drawButton = null;
    this._drawPrimed = true;
    this._drawOrigin = origin;
    this._drawStartAnchor = { kind: 'port', junctionId, portName };
    this._drawPath = [origin, {
      col: origin.col + delta.col,
      row: origin.row + delta.row,
    }];
    this._hoverPoint = null;
    this._hoverOpenEnd = null;
    this._hoverValidAnchor = false;
    this._guidedPath = null;
    this.renderer.renderBeamPipePreview(this._drawPath, 'add', this._previewCost());
    return true;
  }

  /** Render the assistant's exact proposed on-pipe slot before it is bought. */
  showGuidedPlacement({ pipeId, type, position }) {
    const pipe = (this.game.state?.beamPipes || []).find(p => p.id === pipeId);
    const def = COMPONENTS[type];
    if (!pipe || !def || !Number.isFinite(position)) return false;
    const subL = def.subL || 2;
    const inline = def.attachmentKind === 'inline';
    const centerFraction = inline ? position : position + (subL / pipe.subL) / 2;
    const point = positionToPoint(pipe, centerFraction);
    if (!point) return false;
    this._placementHover = { pipeId, position, subL, type, inline };
    this.renderer.renderAttachmentGhost?.(
      point.col, point.row, type, point.dir, true, null,
      this.input.placementPortsFlipped === true,
    );
    return true;
  }

  _reportPlacementFailure(message) {
    if (typeof this.input?._showPlacementFailure === 'function') {
      this.input._showPlacementFailure(message);
      return;
    }
    this.game.log?.(message, 'bad');
    this.input?._showToast?.(message);
  }

  _junctionFailureMessage(def, placeable, hover, result) {
    if (typeof this.input?._placementFailureMessage === 'function') {
      return this.input._placementFailureMessage(placeable, {
        ...hover, valid: false, reason: result.reason,
      });
    }
    if (result.wallBlocked) return `Can't place ${def.name}: its footprint crosses a wall.`;
    if (!result.affordable) return `Can't afford ${def.name}.`;
    return `Can't place ${def.name}: that space is occupied.`;
  }

  _pipeSlotFailureMessage(def, pipe, position, subL, reason, inline = false) {
    if (reason === 'overlap') {
      const blocker = (pipe.placements || []).find((placed) =>
        placementsConflict(pipe.subL, { position, subL, inline }, placed));
      const blockerName = blocker && COMPONENTS[blocker.type]?.name;
      return blockerName
        ? `Can't place ${def.name}: that stretch of pipe is occupied by ${blockerName}.`
        : `Can't place ${def.name}: that stretch of pipe is already occupied.`;
    }
    if (reason === 'full') return `Can't place ${def.name}: there is not enough free pipe length.`;
    if (reason === 'nothing_to_replace') return `Can't place ${def.name}: there is no component there to replace.`;
    return `Can't place ${def.name} on this pipe (${reason || 'invalid position'}).`;
  }

  onHover(worldX, worldY, selectedId, options = {}) {
    if (!selectedId) return;
    const def = COMPONENTS[selectedId];
    if (!def) return;
    if (def.role === 'junction') {
      return this._previewJunction(selectedId, worldX, worldY, options);
    } else if (def.role === 'placement') {
      return this._previewPlacement(selectedId, worldX, worldY);
    }
  }

  /**
   * Hover-preview feedback for the pipe-draw tool (before a click). Updates
   * `hoverPoint`/`hoverOpenEnd` so ThreeRenderer's animate loop can draw the
   * pre-click marker. Called from BeamlineTool's mousemove path.
   */
  onPipeToolHover(worldX, worldY, screen) {
    this._guidedPath = null;
    const snapped = snapPipePoint(worldX, worldY);
    // If the cursor is near an existing pipe's open (capped) end, snap the
    // hover marker to that exact point so the player sees "you can start
    // here" before clicking.
    const openEnd = this._findOpenEndNearCursor(snapped, screen);
    if (openEnd) {
      this._hoverPoint = { col: openEnd.point.col, row: openEnd.point.row };
      this._hoverOpenEnd = { pipeId: openEnd.pipeId, openEnd: openEnd.openEnd };
      this._hoverValidAnchor = true;
    } else {
      const port = this._findPortNearCursor(snapped, screen);
      // Put the marker on the actual flange, not merely on the nearby cursor
      // snap that happened to acquire it. The preview and eventual pipe now
      // meet the same visible point.
      this._hoverPoint = port
        ? { col: port.pathPos.col, row: port.pathPos.row }
        : snapped;
      this._hoverOpenEnd = null;
      // A draw can only START on a junction port or an open pipe end
      // (_pipeDrawStart). Anywhere else the click is discarded, so the marker
      // must not be painted in the valid-placement green — it used to be, and
      // the very first gesture a new player makes (the source auto-arms the
      // drift tool) looked legal and did nothing.
      this._hoverValidAnchor = !!port;
    }
  }

  /** Find an available beam exit on a source for idle direct manipulation. */
  findSourcePortAt(worldX, worldY, screen) {
    return this._findPortNearCursor(
      snapPipePoint(worldX, worldY), screen, { sourceOnly: true },
    );
  }

  onMouseDown(worldX, worldY, button, selectedId, screen) {
    // Pipe-draw tool: left-click starts a draw anchored at a port or open
    // end; right-click drag starts a remove-sweep.
    if (selectedId && COMPONENTS[selectedId]?.isDrawnConnection) {
      // A second button pressed mid-gesture must not re-anchor or flip the
      // mode: pressing right during a left draw used to convert the whole
      // gesture into a destructive remove-sweep (and vice versa). Swallow it.
      if (this._drawing) {
        // A source-created ghost exists before the player presses. The first
        // left press claims it as a normal draw; right press cancels it so the
        // ordinary right-click tool behavior can take over on release.
        if (this._drawPrimed) {
          if (button === 0) {
            this._drawPrimed = false;
            this._drawButton = 0;
          } else if (button === 2) {
            this._resetDrawing();
          }
        }
        return true;
      }
      if (button === 0) return this._pipeDrawStart(worldX, worldY, screen);
      if (button === 2) return this._pipeRemoveStart(worldX, worldY);
      return false;
    }

    if (button !== 0) return false;
    if (!selectedId) return false;
    const def = COMPONENTS[selectedId];
    if (!def) return false;
    if (def.role === 'placement') {
      return this._commitPlacement(selectedId, worldX, worldY);
    }
    if (def.role !== 'junction') return false;
    const placeable = PLACEABLES[selectedId];
    if (!placeable) return false;
    const dir = this.input.placementDir || 0;
    const snap = snapForPlaceable(worldX, worldY, placeable, dir);
    const hover = {
      id: selectedId, col: snap.col, row: snap.row,
      subCol: snap.subCol, subRow: snap.subRow, dir,
    };
    const preview = previewPlacement(
      this.game, placeable,
      snap.col, snap.row, snap.subCol, snap.subRow, dir,
    );
    if (!preview.ok) {
      this._reportPlacementFailure(
        this._junctionFailureMessage(def, placeable, hover, preview),
      );
      return true;
    }
    if (typeof this.game.isComponentUnlocked === 'function'
        && !this.game.isComponentUnlocked(def)) {
      this._reportPlacementFailure(`${def.name} is not researched yet.`);
      return true;
    }
    // placeJunction routes through placePlaceable and prices itself, so the
    // mutation stays uncharged here after the preflight above.
    const placedId = this.game.commitGesture({
      mutate: () => this.game.beamline.placeJunction({
        type: selectedId,
        col: snap.col,
        row: snap.row,
        subCol: snap.subCol,
        subRow: snap.subRow,
        dir,
        params: this.input.selectedParamOverrides,
        portsFlipped: this.input.placementPortsFlipped === true,
      }),
    });
    // Sources auto-advance the tool to the beam-pipe draw tool (same UX
    // the old generic path provided).
    if (placedId && def.isSource && typeof this.input?.selectComponentTool === 'function') {
      const guided = this.game._guidedSetup?.onSourcePlaced?.(placedId);
      if (!guided) {
        if (typeof this.input.beginBeamPipeFromSource === 'function') {
          this.input.beginBeamPipeFromSource(placedId);
        } else {
          this.input.selectComponentTool('drift');
          this.showGuidedPipeStart(placedId, 'exit');
        }
      }
    }
    return true;
  }

  onMouseMove(worldX, worldY, screen) {
    if (!this._drawing) return;
    const pt = this._drawMode === 'remove'
      ? snapPipePoint(worldX, worldY)
      : this._resolveDrawTarget(worldX, worldY, screen).point;
    const last = this._drawPath[this._drawPath.length - 1];
    if (!last || last.col !== pt.col || last.row !== pt.row) {
      this._drawPath = this._drawMode === 'remove'
        ? buildStraightPath(this._drawOrigin, pt)
        : this._buildDrawPath(pt);
      this.renderer.renderBeamPipePreview(this._drawPath, this._drawMode, this._previewCost());
    }
  }

  // Cost preview uses the same formula as BeamlineSystem.drawPipe so the
  // number shown during drag matches the number charged on release.
  // Duplicated (not imported) because BeamlineSystem's pricing helper is
  // private to the mutation path; the controller only needs to read it.
  _previewCost() {
    if (this._drawMode !== 'add' || this._drawPath.length < 2) return null;
    let tileDist = 0;
    for (let i = 0; i < this._drawPath.length - 1; i++) {
      const a = this._drawPath[i];
      const b = this._drawPath[i + 1];
      tileDist += Math.abs(b.col - a.col) + Math.abs(b.row - a.row);
    }
    const def = COMPONENTS.drift;
    const perTile = def && def.cost && typeof def.cost.funding === 'number' ? def.cost.funding : 10000;
    return { funding: Math.max(1, Math.floor(perTile * Math.max(tileDist, 0.25))) };
  }

  onMouseUp(worldX, worldY, button, screen) {
    if (!this._drawing) return false;
    // A primed source ghost has not received its committing press yet. This
    // also protects against a delayed release from the source-placement click.
    if (this._drawPrimed) return true;
    // Only the button that armed the gesture may commit it. (Releasing the
    // *other* button mid-gesture used to run the commit path.)
    if (button != null && this._drawButton != null && button !== this._drawButton) return true;
    let builtPipeId = null;
    if (this._drawMode === 'remove') {
      this._pipeRemoveEnd(worldX, worldY);
    } else {
      // commitGesture, not a raw push inside _pipeDrawEnd: drawPipe/extendPipe
      // validate on commit (port_mismatch is the common one) and return null,
      // which would otherwise leave a phantom undo entry and clear redo.
      builtPipeId = this.game.commitGesture({
        mutate: () => this._pipeDrawEnd(worldX, worldY, screen),
      });
    }
    this._resetDrawing();
    if (builtPipeId) this.game._guidedSetup?.onPipeBuilt?.(builtPipeId);
    return true;
  }

  onRotate() {
    // no-op
  }

  isActive() {
    return this._drawing;
  }

  reset() {
    this._resetDrawing();
  }

  // -------------------------------------------------------------------------
  // Internals.
  // -------------------------------------------------------------------------

  _previewJunction(selectedId, worldX, worldY, options = {}) {
    const placeable = PLACEABLES[selectedId];
    if (!placeable) return;
    const dir = this.input.placementDir || 0;
    const snap = snapForPlaceable(worldX, worldY, placeable, dir);
    // previewPlacement, not canPlace: placeJunction routes through
    // Game.placePlaceable, which also rejects on cost — a green ghost over an
    // unaffordable junction is a lie.
    const result = previewPlacement(
      this.game, placeable,
      snap.col, snap.row, snap.subCol, snap.subRow, dir,
      options,
    );
    // Controller owns rendering/commit for a newly armed junction. During a
    // move, InputHandler also retains this returned pose so MoveTool can drop
    // the existing stable-id junction through Game.movePlaceable.
    const hover = {
      id: selectedId,
      col: snap.col,
      row: snap.row,
      subCol: snap.subCol,
      subRow: snap.subRow,
      dir,
      portsFlipped: this.input.placementPortsFlipped === true,
      placeY: 0,
      stackTargetId: null,
      valid: result.ok,
      reason: result.reason,
    };
    this.renderer.renderPlaceableGhost(hover, result.ok, result.reason);
    // InputHandler uses this returned pose when a placed junction is being
    // carried. Normal BeamlineTool commits still stay controller-owned.
    return hover;
  }

  // --- placement-on-pipe preview + commit --------------------------------

  // Convert iso-screen cursor → 3D world (x, z). A tile (col, row) occupies
  // world [col*2, col*2+2] × [row*2, row*2+2]; isoToGridFloat returns float
  // grid indices where integer = tile corner, so multiply by 2.
  _cursorWorldXZ(worldX, worldY) {
    const gf = isoToGridFloat(worldX, worldY);
    return { wx: gf.col * 2, wz: gf.row * 2 };
  }

  // Overlap check in pipe fraction-space. Inline point slots may share an
  // ordinary placement's edge, but not its interior or another point slot.
  _isOverlappingAtPosition(pipe, position, subL, inline = false) {
    const pipeSubL = pipe.subL;
    if (!pipeSubL || pipeSubL <= 0) return false;
    const candidate = { position, subL, inline };
    const existing = pipe.placements || [];
    for (const pl of existing) {
      if (placementsConflict(pipeSubL, candidate, pl)) return true;
    }
    return false;
  }

  _previewPlacement(selectedId, worldX, worldY) {
    const def = COMPONENTS[selectedId];
    if (!def) return;
    const pipes = (this.game.state && this.game.state.beamPipes) || [];
    const { wx, wz } = this._cursorWorldXZ(worldX, worldY);
    const hit = findNearestPipeToWorld(pipes, wx, wz, 1.5);
    const gf = isoToGridFloat(worldX, worldY);
    const cursorCol = Math.floor(gf.col);
    const cursorRow = Math.floor(gf.row);
    if (!hit) {
      this._placementHover = null;
      // Tint the cursor tile as a refusal instead of showing a bare grid: the
      // "must be placed on a beam pipe" rule was invisible until the click.
      this.renderer.renderPlacementGridOnly?.(cursorCol, cursorRow, 'needs-pipe');
      return;
    }
    const subL = (typeof def.subL === 'number' && def.subL > 0) ? def.subL : 2;
    const inline = def.attachmentKind === 'inline';
    const mode = this.game.state.placementMode || 'snap';
    const quantizedPosition = quantizePlacementPosition(
      hit.pipe, hit.proj.position, subL, inline,
    );
    let valid;
    if (mode === 'snap') {
      // WYSIWYG: show RED at the cursor when overlapping. findSlot's snap
      // auto-shifts to the nearest free gap and would return ok=true at a
      // DIFFERENT position, which is misleading for a hover preview.
      valid = !this._isOverlappingAtPosition(hit.pipe, quantizedPosition, subL, inline);
    } else {
      const dryRun = findSlot(hit.pipe, {
        type: selectedId,
        requestedPosition: quantizedPosition,
        subL,
        inline,
        mode,
        idGenerator: () => 'dry',
        params: {},
      });
      valid = !!dryRun.ok;
    }
    // placeOnPipe charges def.cost (plus spares, fix round 1) itself, so the
    // slot fitting isn't enough for a green ghost. Kept separate from
    // `valid` so _placementHover still records the geometrically-good slot
    // and the tint can say "too expensive" rather than "won't fit".
    // Fix round 3: componentCostFor(def), not the bare def.cost — this ghost
    // used to check funding only, so a spares-short on-pipe part (placeOnPipe
    // has charged spares since fix round 1) still previewed green and then
    // refused on click.
    const affordable = canAffordCost(this.game, componentCostFor(def));
    this._placementHover = valid
      ? { pipeId: hit.pipe.id, position: quantizedPosition, subL, type: selectedId, inline }
      : null;
    // Center an ordinary ghost on its claimed span. Inline geometry is
    // centered directly on its point anchor.
    const centerFraction = inline
      ? quantizedPosition
      : quantizedPosition + (subL / hit.pipe.subL) / 2;
    const centerPoint = positionToPoint(hit.pipe, centerFraction) || hit.proj;
    if (this.renderer.renderAttachmentGhost) {
      this.renderer.renderAttachmentGhost(
        centerPoint.col, centerPoint.row, selectedId, centerPoint.dir,
        valid && affordable,
        (valid && !affordable) ? PLACE_UNAFFORDABLE : null,
        this.input.placementPortsFlipped === true,
      );
    }
  }

  _commitPlacement(selectedId, worldX, worldY) {
    const def = COMPONENTS[selectedId];
    if (!def) return true;
    // Re-project at click time rather than trusting the cached hover, so a
    // click that arrives before the first hover (e.g. synthetic test events)
    // still resolves cleanly.
    const pipes = (this.game.state && this.game.state.beamPipes) || [];
    const { wx, wz } = this._cursorWorldXZ(worldX, worldY);
    const hit = findNearestPipeToWorld(pipes, wx, wz, 1.5);
    if (!hit) {
      this._reportPlacementFailure(`${def.name || selectedId} must be placed on a beam pipe.`);
      return true;
    }
    const subL = (typeof def.subL === 'number' && def.subL > 0) ? def.subL : 2;
    const inline = def.attachmentKind === 'inline';
    const mode = this.game.state.placementMode || 'snap';
    const quantizedPosition = quantizePlacementPosition(
      hit.pipe, hit.proj.position, subL, inline,
    );
    if (typeof this.game.isComponentUnlocked === 'function'
        && !this.game.isComponentUnlocked(def)) {
      this._reportPlacementFailure(`${def.name || selectedId} is not researched yet.`);
      return true;
    }
    const cost = componentCostFor(def);
    if (!canAffordCost(this.game, cost)) {
      const missing = this.game?._missingResourceLabel?.(cost);
      this._reportPlacementFailure(
        `Can't afford ${def.name || selectedId}${missing ? ` (${missing})` : ''}.`,
      );
      return true;
    }
    const dryRun = findSlot(hit.pipe, {
      type: selectedId,
      requestedPosition: quantizedPosition,
      subL,
      inline,
      mode,
      idGenerator: () => 'dry',
      params: {},
    });
    if (!dryRun.ok) {
      this._reportPlacementFailure(
        this._pipeSlotFailureMessage(
          def, hit.pipe, quantizedPosition, subL, dryRun.reason, inline,
        ),
      );
      return true;
    }
    const placedId = this.game.commitGesture({
      mutate: () => this.game.beamline.placeOnPipe(hit.pipe.id, {
        type: selectedId,
        position: quantizedPosition,
        subL,
        inline,
        mode,
        params: this.input.selectedParamOverrides,
        portsFlipped: this.input.placementPortsFlipped === true,
      }),
    });
    if (placedId) {
      const guided = this.game._guidedSetup?.onComponentBuilt?.(hit.pipe.id, placedId);
      // Refresh the ghost so the user sees the next valid hover immediately
      // after committing (the previous ghost may now overlap the new placement).
      if (!guided) this._previewPlacement(selectedId, worldX, worldY);
    }
    return true;
  }

  // --- pipe draw: start ---------------------------------------------------

  _pipeDrawStart(worldX, worldY, screen) {
    // Origin must snap to a junction port OR an existing pipe's open end.
    // Anywhere else is a miss — swallow the click with no side effects so
    // the user doesn't accidentally create floating stubs.
    const cursor = snapPipePoint(worldX, worldY);
    const port = this._findPortNearCursor(cursor, screen);
    if (port) {
      this._guidedPath = null;
      this._drawing = true;
      this._drawMode = 'add';
      this._drawButton = 0;
      this._drawPrimed = false;
      this._drawOrigin = { col: port.pathPos.col, row: port.pathPos.row };
      this._drawStartAnchor = { kind: 'port', junctionId: port.junctionId, portName: port.portName };
      this._drawPath = [this._drawOrigin];
      this.renderer.renderBeamPipePreview(this._drawPath, 'add');
      return true;
    }
    const openEnd = this._findOpenEndNearCursor(cursor, screen);
    if (openEnd) {
      this._guidedPath = null;
      this._drawing = true;
      this._drawMode = 'add';
      this._drawButton = 0;
      this._drawPrimed = false;
      this._drawOrigin = { col: openEnd.point.col, row: openEnd.point.row };
      this._drawStartAnchor = { kind: 'openEnd', pipeId: openEnd.pipeId, openEnd: openEnd.openEnd };
      this._drawPath = [this._drawOrigin];
      this.renderer.renderBeamPipePreview(this._drawPath, 'add');
      return true;
    }
    // No valid anchor. Swallow the click so the generic path doesn't see it,
    // but SAY so — this used to be completely silent while the hover marker
    // was painted valid-green, so the click looked legal and did nothing.
    this.game.log('Beam pipes must start at a component port or an open pipe end', 'bad');
    return true;
  }

  _pipeRemoveStart(worldX, worldY) {
    const startPt = snapPipePoint(worldX, worldY);
    this._drawing = true;
    this._drawMode = 'remove';
    this._drawButton = 2;
    this._drawPrimed = false;
    this._drawOrigin = startPt;
    this._drawStartAnchor = null;
    this._drawPath = [startPt];
    this.renderer.renderBeamPipePreview(this._drawPath, 'remove');
    return true;
  }

  // --- pipe draw: end -----------------------------------------------------

  _pipeDrawEnd(worldX, worldY, screen) {
    const target = this._resolveDrawTarget(worldX, worldY, screen);
    const endPt = target.point;
    let path = this._buildDrawPath(endPt);
    // Zero-length drag: extend by one sub-tile so a bare click still creates
    // a visible stub. Use the port's outward direction when starting from a
    // port (otherwise validateDrawPipe would reject on port_mismatch); fall
    // back to placementDir for open-end starts.
    if (path.length === 1) {
      const start = path[0];
      const stub = this._stubStep();
      path = [start, { col: start.col + stub.dCol * 0.25, row: start.row + stub.dRow * 0.25 }];
    }

    const anchorStart = this._drawStartAnchor;
    const portEnd = target.port;
    const openEndHit = target.openEnd;

    // Undo capture is the caller's (onMouseUp wraps this in game._withUndo).

    // Starting from an existing pipe's open end → extend it. buildStraightPath
    // anchors at `_drawOrigin` (the open end's point) and moves outward to the
    // cursor, matching validateExtendPipe's expected direction.
    if (anchorStart?.kind === 'openEnd') {
      if (portEnd) {
        return this.game.beamline.extendPipeToPort(
          anchorStart.pipeId, path, portEnd.junctionId, portEnd.portName,
        );
      }
      return this.game.beamline.extendPipe(anchorStart.pipeId, path);
    }

    // From here the start is a port (or nothing). Build the start anchor now.
    const startAnchor = anchorStart?.kind === 'port'
      ? { junctionId: anchorStart.junctionId, portName: anchorStart.portName }
      : null;

    // Port → port (distinct) → full port-to-port pipe.
    if (portEnd && (!anchorStart || portEnd.junctionId !== anchorStart.junctionId || portEnd.portName !== anchorStart.portName)) {
      return this.game.beamline.drawPipe(
        startAnchor,
        { junctionId: portEnd.junctionId, portName: portEnd.portName },
        path,
      );
    }

    // Port → existing pipe's open end → extend that pipe and claim the
    // origin port atomically. validateExtendPipe expects additionalPath to flow
    // OUTWARD from the open end, so reverse the drawn path (which flows
    // origin→cursor = port→openEnd = inward).
    if (openEndHit) {
      const reversed = path.slice().reverse();
      return this.game.beamline.extendPipeToPort(
        openEndHit.pipeId, reversed, anchorStart.junctionId, anchorStart.portName,
      );
    }

    // Open-ended pipe (from port, terminates in empty space).
    return this.game.beamline.drawPipe(startAnchor, null, path);
  }

  _pipeRemoveEnd(worldX, worldY) {
    const endPt = snapPipePoint(worldX, worldY);
    const path = buildStraightPath(this._drawOrigin, endPt);
    const pipesToRemove = new Set();
    for (const pipe of this.game.state.beamPipes) {
      for (const pt of path) {
        if (pipe.path.some(pp =>
          Math.abs(pp.col - pt.col) < PIPE_REMOVE_EPS &&
          Math.abs(pp.row - pt.row) < PIPE_REMOVE_EPS)) {
          pipesToRemove.add(pipe.id);
          break;
        }
      }
    }
    // commitGesture, not a raw push: a remove-sweep that crosses no pipe (or
    // whose pipes all refuse removal) must not leave a phantom undo entry.
    // _batchEvents so a multi-pipe sweep rebuilds the beamline meshes once.
    this.game.commitGesture({
      validate: () => pipesToRemove.size > 0,
      mutate: () => this.game._batchEvents(() => {
        for (const id of pipesToRemove) this.game.removeBeamPipe(id);
      }),
    });
  }

  // The first segment of either legal add gesture already determines the
  // axis: junction ports have a compass-facing normal, while pipe extensions
  // continue the terminal segment. Projecting the hand onto that axis makes
  // a slightly diagonal drag feel straight instead of previewing a path the
  // validator will throw away on release.
  _drawAxis() {
    const anchor = this._drawStartAnchor;
    if (anchor?.kind === 'port') {
      const p = this._findPlaceable(anchor.junctionId);
      const side = p && portSide(p, anchor.portName);
      if (side === 'N') return { dCol: 0, dRow: -1 };
      if (side === 'S') return { dCol: 0, dRow: 1 };
      if (side === 'E') return { dCol: 1, dRow: 0 };
      if (side === 'W') return { dCol: -1, dRow: 0 };
      return null;
    }
    if (anchor?.kind !== 'openEnd') return null;
    const pipe = (this.game.state?.beamPipes || []).find(p => p.id === anchor.pipeId);
    const path = pipe?.path || [];
    if (path.length < 2) return null;
    const tipIndex = anchor.openEnd === 'start' ? 0 : path.length - 1;
    const neighborIndex = anchor.openEnd === 'start' ? 1 : path.length - 2;
    const tip = path[tipIndex];
    const neighbor = path[neighborIndex];
    const dc = tip.col - neighbor.col;
    const dr = tip.row - neighbor.row;
    if (Math.abs(dc) >= Math.abs(dr) && Math.abs(dc) > 1e-9) {
      return { dCol: Math.sign(dc), dRow: 0 };
    }
    if (Math.abs(dr) > 1e-9) return { dCol: 0, dRow: Math.sign(dr) };
    return null;
  }

  _pointOnDrawRay(point, axis = this._drawAxis()) {
    if (!point || !axis || !this._drawOrigin) return false;
    const dc = point.col - this._drawOrigin.col;
    const dr = point.row - this._drawOrigin.row;
    const cross = dc * axis.dRow - dr * axis.dCol;
    const forward = dc * axis.dCol + dr * axis.dRow;
    return Math.abs(cross) < 1e-6 && forward > 1e-6;
  }

  _buildDrawPath(point) {
    return buildStraightPath(this._drawOrigin, point);
  }

  _resolveDrawTarget(worldX, worldY, screen) {
    const cursor = snapPipePoint(worldX, worldY);
    const axis = this._drawAxis();
    const start = this._drawStartAnchor;
    const reachable = hit => this._pointOnDrawRay(hit.pathPos || hit.point, axis);

    const port = this._findPortNearCursor(cursor, screen, {
      accept: hit => {
        const isStart = start?.kind === 'port'
          && hit.junctionId === start.junctionId
          && hit.portName === start.portName;
        return !isStart && reachable(hit);
      },
    });
    if (port) return {
      point: { col: port.pathPos.col, row: port.pathPos.row },
      port,
      openEnd: null,
    };

    const openEnd = this._findOpenEndNearCursor(cursor, screen, {
      accept: hit => {
        const isStart = start?.kind === 'openEnd'
          && hit.pipeId === start.pipeId
          && hit.openEnd === start.openEnd;
        return !isStart && reachable(hit);
      },
    });
    if (openEnd) return {
      point: { col: openEnd.point.col, row: openEnd.point.row },
      port: null,
      openEnd,
    };

    if (!axis || !this._drawOrigin) return { point: cursor, port: null, openEnd: null };
    const dc = cursor.col - this._drawOrigin.col;
    const dr = cursor.row - this._drawOrigin.row;
    // Keep the sign: dragging behind a flange must remain a rejected backward
    // path, not silently buy a forward stub. Quantize after projection so the
    // preview stays on the pipe's quarter-tile grid.
    const along = Math.round((dc * axis.dCol + dr * axis.dRow) * 4) / 4;
    return {
      point: {
        col: this._drawOrigin.col + axis.dCol * along,
        row: this._drawOrigin.row + axis.dRow * along,
      },
      port: null,
      openEnd: null,
    };
  }

  // Outward unit vector (in pipe-path space) for the zero-drag stub. Uses the
  // port's rotated compass side if starting from a port; falls back to the
  // current placementDir for open-end starts.
  _stubStep() {
    const anchor = this._drawStartAnchor;
    if (anchor?.kind === 'port') {
      const p = this._findPlaceable(anchor.junctionId);
      if (p) {
        const side = portSide(p, anchor.portName);
        if (side) {
          // +row = south/+z, +col = east/+x.
          if (side === 'N') return { dCol: 0, dRow: -1 };
          if (side === 'S') return { dCol: 0, dRow: 1 };
          if (side === 'E') return { dCol: 1, dRow: 0 };
          if (side === 'W') return { dCol: -1, dRow: 0 };
        }
      }
    }
    const delta = DIR_DELTA[this.input.placementDir || 0];
    return { dCol: delta.dc, dRow: delta.dr };
  }

  _findPlaceable(id) {
    const list = (this.game.state && this.game.state.placeables) || [];
    for (const p of list) if (p && p.id === id) return p;
    return null;
  }

  // --- hit-testing --------------------------------------------------------

  // Hit-tests operate in pipe-path coordinate space (`col*2+1`-indexed, where
  // col/row = 0 renders at world x/z = 1). Callers pre-snap the cursor via
  // snapPipePoint so it's already in this space, and port world coords are
  // converted on the fly.
  _findPortNearCursor(cursor, screen, { sourceOnly = false, accept = null } = {}) {
    const state = this.game.state;
    const placeables = (state && state.placeables) || [];
    const beamPipes = (state && state.beamPipes) || [];
    const accepted = typeof accept === 'function' ? accept : () => true;
    const portHit = (p, portName, pos) => ({
      junctionId: p.id,
      portName,
      pathPos: { col: (pos.x - 1) / 2, row: (pos.z - 1) / 2 },
    });
    const candidatePlaceable = (p) => {
      const def = COMPONENTS[p.type];
      return def && def.role === 'junction' && def.ports
        && (!sourceOnly || def.isSource);
    };

    // In the live renderer, acquire the flange where it is actually drawn:
    // at BEAM_PIPE_Y and projected through the camera. Ground-plane picking
    // targets the flange's shadow and changes its effective radius with zoom.
    const canProject = !!(screen && this.renderer
      && typeof this.renderer.worldToScreen === 'function');
    if (canProject) {
      let best = null;
      let bestDist = Infinity;
      for (const p of placeables) {
        if (!candidatePlaceable(p)) continue;
        const def = COMPONENTS[p.type];
        const snapRadius = def?.isSource
          ? SOURCE_PIPE_SNAP_RADIUS_PX
          : PIPE_SNAP_RADIUS_PX;
        for (const portName of availablePorts(p, beamPipes)) {
          const pos = portWorldPosition(p, portName);
          if (!pos) continue;
          const hit = portHit(p, portName, pos);
          if (!accepted(hit)) continue;
          const projected = this.renderer.worldToScreen(pos.x, BEAM_PIPE_Y, pos.z);
          if (!projected) continue;
          const dist = Math.hypot(projected.x - screen.x, projected.y - screen.y);
          if (dist < snapRadius && dist < bestDist) {
            bestDist = dist;
            best = hit;
          }
        }
      }
      return best;
    }

    // Cursor is over a junction's footprint → snap to that junction's nearest
    // available port, regardless of distance. Users expect clicking anywhere
    // on a junction's visible tile to start a pipe from it, not just within a
    // half-tile radius of the exact port point.
    //
    // snapPipePoint quantizes to 0.25-steps in path-space where integer = tile
    // center. A naive Math.round(cursor.col) pushes half-tile clicks (e.g. 5.5)
    // to the WRONG tile (6 instead of 5). To avoid that, we check all 4 nearby
    // tiles (floor/ceil of col × floor/ceil of row) and take the closest port
    // from any junction whose footprint contains one of those tiles.
    const cFloor = Math.floor(cursor.col);
    const cCeil = Math.ceil(cursor.col);
    const rFloor = Math.floor(cursor.row);
    const rCeil = Math.ceil(cursor.row);
    const checkedTiles = [
      { col: cFloor, row: rFloor },
      { col: cCeil, row: rFloor },
      { col: cFloor, row: rCeil },
      { col: cCeil, row: rCeil },
    ];
    const tileKey = (c, r) => c + ',' + r;
    const checkedSet = new Set(checkedTiles.map(t => tileKey(t.col, t.row)));

    let footprintBest = null;
    let footprintBestDist = Infinity;
    for (const p of placeables) {
      if (!candidatePlaceable(p)) continue;
      const cells = p.cells || [{ col: p.col, row: p.row }];
      const onFootprint = cells.some(c => checkedSet.has(tileKey(c.col, c.row)));
      if (!onFootprint) continue;
      const avail = availablePorts(p, beamPipes);
      if (avail.length === 0) continue;
      for (const portName of avail) {
        const pos = portWorldPosition(p, portName);
        if (!pos) continue;
        const hit = portHit(p, portName, pos);
        if (!accepted(hit)) continue;
        const pathCol = hit.pathPos.col;
        const pathRow = hit.pathPos.row;
        const d = Math.abs(pathCol - cursor.col) + Math.abs(pathRow - cursor.row);
        if (d < footprintBestDist) {
          footprintBestDist = d;
          footprintBest = hit;
        }
      }
    }

    if (footprintBest) return footprintBest;

    // Fallback: cursor is off any junction footprint — snap to any port within
    // PIPE_SNAP_RADIUS (clicks just past the port edge).
    let best = null;
    let bestDist = Infinity;
    for (const p of placeables) {
      if (!candidatePlaceable(p)) continue;
      const avail = availablePorts(p, beamPipes);
      for (const portName of avail) {
        const pos = portWorldPosition(p, portName);
        if (!pos) continue;
        const hit = portHit(p, portName, pos);
        if (!accepted(hit)) continue;
        const pathCol = hit.pathPos.col;
        const pathRow = hit.pathPos.row;
        const dc = Math.abs(pathCol - cursor.col);
        const dr = Math.abs(pathRow - cursor.row);
        if (dc < PIPE_SNAP_RADIUS && dr < PIPE_SNAP_RADIUS) {
          const dist = dc + dr;
          if (dist < bestDist) {
            bestDist = dist;
            best = hit;
          }
        }
      }
    }
    return best;
  }

  _findOpenEndNearCursor(cursor, screen, { accept = null } = {}) {
    const state = this.game.state;
    const pipes = (state && state.beamPipes) || [];
    const accepted = typeof accept === 'function' ? accept : () => true;
    const canProject = !!(screen && this.renderer
      && typeof this.renderer.worldToScreen === 'function');
    let best = null;
    let bestDist = canProject ? PIPE_SNAP_RADIUS_PX : Infinity;
    for (const pipe of pipes) {
      const candidates = [];
      if (pipe.start === null && pipe.path && pipe.path.length > 0) {
        candidates.push({ pipeId: pipe.id, openEnd: 'start', point: pipe.path[0] });
      }
      if (pipe.end === null && pipe.path && pipe.path.length > 0) {
        candidates.push({ pipeId: pipe.id, openEnd: 'end', point: pipe.path[pipe.path.length - 1] });
      }
      for (const c of candidates) {
        if (!accepted(c)) continue;
        let dist;
        if (canProject) {
          const px = this.renderer.worldToScreen(
            c.point.col * 2 + 1, BEAM_PIPE_Y, c.point.row * 2 + 1,
          );
          if (!px) continue;
          dist = Math.hypot(px.x - screen.x, px.y - screen.y);
        } else {
          const dc = Math.abs(c.point.col - cursor.col);
          const dr = Math.abs(c.point.row - cursor.row);
          if (dc >= PIPE_SNAP_RADIUS || dr >= PIPE_SNAP_RADIUS) continue;
          dist = dc + dr;
        }
        if (dist < bestDist) {
          bestDist = dist;
          best = c;
        }
      }
    }
    return best;
  }

  _resetDrawing() {
    this._drawing = false;
    this._drawMode = 'add';
    this._drawButton = null;
    this._drawPrimed = false;
    this._drawPath = [];
    this._drawOrigin = null;
    this._drawStartAnchor = null;
    this._guidedPath = null;
    this.renderer.clearDragPreview?.();
  }
}
