// src/input/BeamlineInputController.js
//
// All beamline-related input: junction placement ghost, pipe drawing,
// placement-on-pipe ghost. Translates cursor events into BeamlineSystem
// calls. Owned by InputHandler; InputHandler delegates beamline input
// here when the selected tool is a beamline component or pipe-drawing.

import { COMPONENTS } from '../data/components.js';
import { PLACEABLES } from '../data/placeables/index.js';
import { snapForPlaceable, canPlace } from '../game/placement.js';
import { DIR_DELTA } from '../data/directions.js';
import { availablePorts, portWorldPosition, portSide } from '../beamline/junctions.js';
import {
  snapPipePoint,
  buildStraightPath,
  findNearestPipeToWorld,
  positionToPoint,
} from '../beamline/pipe-geometry.js';
import { findSlot } from '../beamline/pipe-placements.js';
import { isoToGridFloat } from '../renderer/grid.js';

// Hit-test radius (pipe-path units) for snapping the pipe-draw cursor to a
// junction port or an existing pipe's open end. 1 unit = half a tile in
// path-space (since pipe paths use *2+1 indexing), so 0.5 covers roughly
// half a tile — generous enough that the user rarely misses but tight
// enough to avoid bleeding into adjacent sub-cells on dense layouts.
const PIPE_SNAP_RADIUS = 0.5;
// Tolerance for matching a pipe path point during right-click-drag removal.
// Matches the value used in the legacy InputHandler flow.
const PIPE_REMOVE_EPS = 0.13;

export class BeamlineInputController {
  constructor({ game, renderer, inputHandler }) {
    this.game = game;
    this.renderer = renderer;
    // Back-reference so the controller can read the current placement tool
    // and direction without duplicating selection state. InputHandler owns
    // selection; the controller owns beamline-specific input interpretation.
    this.input = inputHandler;

    // Pipe-draw state. While _drawing === true, InputHandler should route
    // mousemove/mouseup here and skip its other drag paths.
    this._drawing = false;
    this._drawMode = 'add';           // 'add' | 'remove'
    this._drawPath = [];              // [{col,row}] — current preview path
    this._drawOrigin = null;          // snapped start point
    this._drawStartAnchor = null;     // null | { kind:'port', junctionId, portName }
                                       //        | { kind:'openEnd', pipeId, openEnd:'start'|'end' }

    // Last valid placement-on-pipe preview, set by _previewPlacement and
    // consumed by onMouseDown. Null when no pipe is under the cursor or the
    // dry-run findSlot rejects the current mode.
    this._placementHover = null;
  }

  onHover(worldX, worldY) {
    const selectedId = this.input?.selectedPlaceableId;
    if (!selectedId) return;
    const def = COMPONENTS[selectedId];
    if (!def) return;
    if (def.role === 'junction') {
      this._previewJunction(selectedId, worldX, worldY);
    } else if (def.role === 'placement') {
      this._previewPlacement(selectedId, worldX, worldY);
    }
  }

  /**
   * Hover-preview feedback for the pipe-draw tool (before a click). Updates
   * `this.input.hoverPipePoint` so ThreeRenderer's animate loop can draw the
   * pre-click marker. Called from InputHandler's generic mousemove path.
   */
  onPipeToolHover(worldX, worldY) {
    const snapped = snapPipePoint(worldX, worldY);
    // If the cursor is near an existing pipe's open (capped) end, snap the
    // hover marker to that exact point so the player sees "you can start
    // here" before clicking.
    const openEnd = this._findOpenEndNearCursor(snapped);
    if (openEnd) {
      this.input.hoverPipePoint = { col: openEnd.point.col, row: openEnd.point.row };
      this.input.hoverPipeOpenEnd = { pipeId: openEnd.pipeId, openEnd: openEnd.openEnd };
    } else {
      this.input.hoverPipePoint = snapped;
      this.input.hoverPipeOpenEnd = null;
    }
  }

  onMouseDown(worldX, worldY, button) {
    const selectedId = this.input?.selectedPlaceableId;
    const selectedTool = this.input?.selectedTool;

    // Pipe-draw tool: left-click starts a draw anchored at a port or open
    // end; right-click drag starts a remove-sweep.
    if (selectedTool && COMPONENTS[selectedTool]?.isDrawnConnection) {
      if (button === 0) return this._pipeDrawStart(worldX, worldY);
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

  onMouseMove(worldX, worldY) {
    if (!this._drawing) return;
    const pt = snapPipePoint(worldX, worldY);
    const last = this._drawPath[this._drawPath.length - 1];
    if (!last || last.col !== pt.col || last.row !== pt.row) {
      this._drawPath = buildStraightPath(this._drawOrigin, pt);
      if (!this._loggedDrawingFlip) {
        this._loggedDrawingFlip = true;
        console.log('[pipe-draw] onMouseMove: first move while _drawing=true', { pt, pathLen: this._drawPath.length });
      }
      this._syncInputState();
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

  onMouseUp(worldX, worldY /* , button */) {
    console.log('[pipe-draw] onMouseUp: entry', {
      drawing: this._drawing,
      drawMode: this._drawMode,
      pathLen: this._drawPath.length,
      worldX, worldY,
    });
    if (!this._drawing) return false;
    if (this._drawMode === 'remove') {
      this._pipeRemoveEnd(worldX, worldY);
    } else {
      this._pipeDrawEnd(worldX, worldY);
    }
    this._resetDrawing();
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

  // --- placement-on-pipe preview + commit --------------------------------

  // Convert iso-screen cursor → 3D world (x, z). A tile (col, row) occupies
  // world [col*2, col*2+2] × [row*2, row*2+2]; isoToGridFloat returns float
  // grid indices where integer = tile corner, so multiply by 2.
  _cursorWorldXZ(worldX, worldY) {
    const gf = isoToGridFloat(worldX, worldY);
    return { wx: gf.col * 2, wz: gf.row * 2 };
  }

  // Snap the cursor's projected fraction to a subtile-aligned start position.
  // `position` is a fraction [0,1] of pipe arc-length; `pipe.subL` counts
  // 1-subtile increments along the pipe. The cursor projection is treated as
  // the desired CENTER of the component, so `startSubtiles =
  // round(center - subL/2)` keeps the body centered under the cursor and
  // ensures the placement body aligns to subtile boundaries.
  _quantizePipePosition(pipe, cursorPosition, subL) {
    const pipeSubL = pipe.subL;
    if (!pipeSubL || pipeSubL <= 0) return cursorPosition;
    const centerSubtiles = cursorPosition * pipeSubL;
    const startSubtiles = Math.round(centerSubtiles - subL / 2);
    const clamped = Math.max(0, Math.min(pipeSubL - subL, startSubtiles));
    return clamped / pipeSubL;
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
      this.renderer.renderPlacementGridOnly?.(cursorCol, cursorRow);
      return;
    }
    const subL = (typeof def.subL === 'number' && def.subL > 0) ? def.subL : 2;
    const mode = this.game.state.placementMode || 'snap';
    const quantizedPosition = this._quantizePipePosition(hit.pipe, hit.proj.position, subL);
    const dryRun = findSlot(hit.pipe, {
      type: selectedId,
      requestedPosition: quantizedPosition,
      subL,
      mode,
      idGenerator: () => 'dry',
      params: {},
    });
    const valid = !!dryRun.ok;
    this._placementHover = valid
      ? { pipeId: hit.pipe.id, position: quantizedPosition, subL, type: selectedId }
      : null;
    // Center the ghost on the component body: sample the pipe at
    // (quantizedStart + subL/2) so the rendered mesh sits over the subtiles
    // it will actually occupy, not at the start edge.
    const centerFraction = quantizedPosition + (subL / hit.pipe.subL) / 2;
    const centerPoint = positionToPoint(hit.pipe, centerFraction) || hit.proj;
    if (this.renderer.renderAttachmentGhost) {
      this.renderer.renderAttachmentGhost(
        centerPoint.col, centerPoint.row, selectedId, centerPoint.dir, valid,
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
    if (!hit) return true;
    const subL = (typeof def.subL === 'number' && def.subL > 0) ? def.subL : 2;
    const mode = this.game.state.placementMode || 'snap';
    const quantizedPosition = this._quantizePipePosition(hit.pipe, hit.proj.position, subL);
    this.game._pushUndo();
    const placedId = this.game.beamline.placeOnPipe(hit.pipe.id, {
      type: selectedId,
      position: quantizedPosition,
      subL,
      mode,
      params: this.input.selectedParamOverrides,
    });
    if (placedId) {
      // Refresh the ghost so the user sees the next valid hover immediately
      // after committing (the previous ghost may now overlap the new placement).
      this._previewPlacement(selectedId, worldX, worldY);
    }
    return true;
  }

  // --- pipe draw: start ---------------------------------------------------

  _pipeDrawStart(worldX, worldY) {
    // Origin must snap to a junction port OR an existing pipe's open end.
    // Anywhere else is a miss — swallow the click with no side effects so
    // the user doesn't accidentally create floating stubs.
    const cursor = snapPipePoint(worldX, worldY);
    console.log('[pipe-draw] _pipeDrawStart: entry', { worldX, worldY, cursor });
    const port = this._findPortNearCursor(cursor);
    console.log('[pipe-draw] _pipeDrawStart: port hit-test', port);
    if (port) {
      const _p = this._findPlaceable(port.junctionId);
      console.warn('[pipe-draw] _pipeDrawStart ANCHORED:', {
        junctionId: port.junctionId,
        junctionType: _p?.type,
        junctionDir: _p?.dir,
        junctionCol: _p?.col,
        junctionRow: _p?.row,
        portName: port.portName,
        portPathPos: port.pathPos,
        cursor,
      });
      this._drawing = true;
      this._drawMode = 'add';
      this._drawOrigin = { col: port.pathPos.col, row: port.pathPos.row };
      this._drawStartAnchor = { kind: 'port', junctionId: port.junctionId, portName: port.portName };
      this._drawPath = [this._drawOrigin];
      this._loggedDrawingFlip = false;
      console.log('[pipe-draw] _pipeDrawStart: anchored on PORT', {
        anchor: this._drawStartAnchor, origin: this._drawOrigin,
      });
      this._syncInputState();
      this.renderer.renderBeamPipePreview(this._drawPath, 'add');
      return true;
    }
    const openEnd = this._findOpenEndNearCursor(cursor);
    console.log('[pipe-draw] _pipeDrawStart: openEnd hit-test', openEnd);
    if (openEnd) {
      this._drawing = true;
      this._drawMode = 'add';
      this._drawOrigin = { col: openEnd.point.col, row: openEnd.point.row };
      this._drawStartAnchor = { kind: 'openEnd', pipeId: openEnd.pipeId, openEnd: openEnd.openEnd };
      this._drawPath = [this._drawOrigin];
      this._loggedDrawingFlip = false;
      console.log('[pipe-draw] _pipeDrawStart: anchored on OPEN-END', {
        anchor: this._drawStartAnchor, origin: this._drawOrigin,
      });
      this._syncInputState();
      this.renderer.renderBeamPipePreview(this._drawPath, 'add');
      return true;
    }
    // No valid anchor: swallow the click so the generic path doesn't see it.
    console.log('[pipe-draw] _pipeDrawStart: NO anchor — click swallowed, no draw');
    return true;
  }

  _pipeRemoveStart(worldX, worldY) {
    const startPt = snapPipePoint(worldX, worldY);
    this._drawing = true;
    this._drawMode = 'remove';
    this._drawOrigin = startPt;
    this._drawStartAnchor = null;
    this._drawPath = [startPt];
    this._syncInputState();
    this.renderer.renderBeamPipePreview(this._drawPath, 'remove');
    return true;
  }

  // --- pipe draw: end -----------------------------------------------------

  _pipeDrawEnd(worldX, worldY) {
    const endPt = snapPipePoint(worldX, worldY);
    let path = buildStraightPath(this._drawOrigin, endPt);
    console.log('[pipe-draw] _pipeDrawEnd: entry', {
      worldX, worldY, endPt,
      origin: this._drawOrigin,
      initialPathLen: path.length,
    });
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
    const portEnd = this._findPortNearCursor(endPt);
    const openEndHit = this._findOpenEndNearCursor(endPt);

    console.log('[pipe-draw] _pipeDrawEnd: resolved', {
      finalPathLen: path.length,
      anchorStart,
      portEnd,
      openEndHit,
    });

    this.game._pushUndo();

    // Starting from an existing pipe's open end → extend it. buildStraightPath
    // anchors at `_drawOrigin` (the open end's point) and moves outward to the
    // cursor, matching validateExtendPipe's expected direction.
    if (anchorStart?.kind === 'openEnd') {
      console.log('[pipe-draw] _pipeDrawEnd: branch = extend-from-openEnd', { pipeId: anchorStart.pipeId });
      console.warn('[pipe-draw] _pipeDrawEnd FINAL PATH for drawPipe:', {
        startAnchor: anchorStart,
        pathLen: path.length,
        path0: path[0],
        path1: path[1],
        pathLast: path[path.length - 1],
      });
      const res = this.game.beamline.extendPipe(anchorStart.pipeId, path);
      console.log('[pipe-draw] _pipeDrawEnd: extendPipe result', res);
      return;
    }

    // From here the start is a port (or nothing). Build the start anchor now.
    const startAnchor = anchorStart?.kind === 'port'
      ? { junctionId: anchorStart.junctionId, portName: anchorStart.portName }
      : null;

    // Port → port (distinct) → full port-to-port pipe.
    if (portEnd && (!anchorStart || portEnd.junctionId !== anchorStart.junctionId || portEnd.portName !== anchorStart.portName)) {
      console.log('[pipe-draw] _pipeDrawEnd: branch = port-to-port', { startAnchor, portEnd });
      console.warn('[pipe-draw] _pipeDrawEnd FINAL PATH for drawPipe:', {
        startAnchor,
        pathLen: path.length,
        path0: path[0],
        path1: path[1],
        pathLast: path[path.length - 1],
      });
      const res = this.game.beamline.drawPipe(
        startAnchor,
        { junctionId: portEnd.junctionId, portName: portEnd.portName },
        path,
      );
      console.log('[pipe-draw] _pipeDrawEnd: drawPipe (port→port) result', res);
      return;
    }

    // Port → existing pipe's open end → extend that pipe. validateExtendPipe
    // expects additionalPath to flow OUTWARD from the open end, so reverse
    // the drawn path (which flows origin→cursor = port→openEnd = inward).
    // Caveat: extendPipe preserves existing anchors, so the origin port is
    // NOT claimed by the resulting pipe. The pipe visually reaches the port
    // but the port remains marked "available". This is the behaviour the
    // plan calls for ("extends rather than creates a disconnected pipe");
    // claiming the port on extend is a future enhancement.
    if (openEndHit) {
      console.log('[pipe-draw] _pipeDrawEnd: branch = port-to-openEnd (extend)', { openEndHit });
      const reversed = path.slice().reverse();
      console.warn('[pipe-draw] _pipeDrawEnd FINAL PATH for drawPipe:', {
        startAnchor,
        pathLen: reversed.length,
        path0: reversed[0],
        path1: reversed[1],
        pathLast: reversed[reversed.length - 1],
      });
      const res = this.game.beamline.extendPipe(openEndHit.pipeId, reversed);
      console.log('[pipe-draw] _pipeDrawEnd: extendPipe (port→openEnd) result', res);
      return;
    }

    // Open-ended pipe (from port, terminates in empty space).
    console.log('[pipe-draw] _pipeDrawEnd: branch = open-ended from port', { startAnchor });
    console.warn('[pipe-draw] _pipeDrawEnd FINAL PATH for drawPipe:', {
      startAnchor,
      pathLen: path.length,
      path0: path[0],
      path1: path[1],
      pathLast: path[path.length - 1],
    });
    const res = this.game.beamline.drawPipe(startAnchor, null, path);
    console.log('[pipe-draw] _pipeDrawEnd: drawPipe (open-ended) result', res);
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
    if (pipesToRemove.size > 0) {
      this.game._pushUndo();
      for (const id of pipesToRemove) {
        this.game.removeBeamPipe(id);
      }
    }
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
  _findPortNearCursor(cursor) {
    const state = this.game.state;
    const placeables = (state && state.placeables) || [];
    const beamPipes = (state && state.beamPipes) || [];

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
    const hits = [];
    for (const p of placeables) {
      const def = COMPONENTS[p.type];
      if (!def || def.role !== 'junction' || !def.ports) continue;
      const cells = p.cells || [{ col: p.col, row: p.row }];
      const onFootprint = cells.some(c => checkedSet.has(tileKey(c.col, c.row)));
      if (!onFootprint) continue;
      const avail = availablePorts(p, beamPipes);
      hits.push({ id: p.id, type: p.type, cells, availablePorts: avail });
      if (avail.length === 0) continue;
      for (const portName of avail) {
        const pos = portWorldPosition(p, portName);
        if (!pos) continue;
        const pathCol = (pos.x - 1) / 2;
        const pathRow = (pos.z - 1) / 2;
        const d = Math.abs(pathCol - cursor.col) + Math.abs(pathRow - cursor.row);
        if (d < footprintBestDist) {
          footprintBestDist = d;
          footprintBest = {
            junctionId: p.id,
            portName,
            pathPos: { col: pathCol, row: pathRow },
          };
        }
      }
    }

    console.log('[pipe-draw] _findPortNearCursor:', {
      cursor,
      checkedTiles,
      hits,
      footprintBest,
    });

    if (footprintBest) return footprintBest;

    // Fallback: cursor is off any junction footprint — snap to any port within
    // PIPE_SNAP_RADIUS (clicks just past the port edge).
    let best = null;
    let bestDist = Infinity;
    for (const p of placeables) {
      const def = COMPONENTS[p.type];
      if (!def || def.role !== 'junction' || !def.ports) continue;
      const avail = availablePorts(p, beamPipes);
      for (const portName of avail) {
        const pos = portWorldPosition(p, portName);
        if (!pos) continue;
        const pathCol = (pos.x - 1) / 2;
        const pathRow = (pos.z - 1) / 2;
        const dc = Math.abs(pathCol - cursor.col);
        const dr = Math.abs(pathRow - cursor.row);
        if (dc < PIPE_SNAP_RADIUS && dr < PIPE_SNAP_RADIUS) {
          const dist = dc + dr;
          if (dist < bestDist) {
            bestDist = dist;
            best = {
              junctionId: p.id,
              portName,
              pathPos: { col: pathCol, row: pathRow },
            };
          }
        }
      }
    }
    return best;
  }

  _findOpenEndNearCursor(cursor) {
    const state = this.game.state;
    const pipes = (state && state.beamPipes) || [];
    let best = null;
    let bestDist = Infinity;
    for (const pipe of pipes) {
      const candidates = [];
      if (pipe.start === null && pipe.path && pipe.path.length > 0) {
        candidates.push({ pipeId: pipe.id, openEnd: 'start', point: pipe.path[0] });
      }
      if (pipe.end === null && pipe.path && pipe.path.length > 0) {
        candidates.push({ pipeId: pipe.id, openEnd: 'end', point: pipe.path[pipe.path.length - 1] });
      }
      for (const c of candidates) {
        const dc = Math.abs(c.point.col - cursor.col);
        const dr = Math.abs(c.point.row - cursor.row);
        if (dc < PIPE_SNAP_RADIUS && dr < PIPE_SNAP_RADIUS) {
          const dist = dc + dr;
          if (dist < bestDist) {
            bestDist = dist;
            best = c;
          }
        }
      }
    }
    return best;
  }

  // --- state sync ---------------------------------------------------------

  // Mirror the draw state onto InputHandler's legacy fields so the renderer's
  // animate loop (which reads drawingBeamPipe/beamPipePath/beamPipeDrawMode
  // directly) keeps working without a controller-aware render path.
  _syncInputState() {
    this.input.drawingBeamPipe = this._drawing;
    this.input.beamPipePath = this._drawPath;
    this.input.beamPipeDrawMode = this._drawMode;
    this.input.beamPipeCost = this._drawing ? this._previewCost() : null;
  }

  _resetDrawing() {
    this._drawing = false;
    this._drawMode = 'add';
    this._drawPath = [];
    this._drawOrigin = null;
    this._drawStartAnchor = null;
    this._syncInputState();
    this.renderer.clearDragPreview?.();
  }
}
