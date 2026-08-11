// src/input/UtilityLineInputController.js
//
// Input controller for drawing utility lines between ports on placeables.
// Parallel to BeamlineInputController but scoped to the utility-line system:
//   - Stores the current utility type (e.g. 'powerCable').
//   - Snaps start/end to ports whose spec.utility matches the current type.
//   - Paths are Manhattan (one 90° bend max) from start port to end port.
//   - Commit on mouse-up calls UtilityLineSystem.addLine().
//
// The controller is the single owner of the tool's render state:
// ThreeRenderer's animate loop reads `utilityType`, `preview`, `hoverPort`
// and `drawStart` straight off this object (no mirrored InputHandler
// fields). UtilityLineTool (src/input/utility-line-tool.js) is the thin
// Tool wrapper that routes InputHandler events here.
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
import { listUtilityEndpoints } from '../utility/utility-endpoints.js';
import { planUtilityRun, runPreviewPath, runWiringCost } from './utility-run-wiring.js';
import { isoToGridFloat } from '../renderer/grid.js';

// Snap tolerance between cursor and a port's world position, in world meters.
// 1.0 = half a tile — roomy so the player can grab a port without needing
// pixel-perfect aim. Tightened automatically (0.5) near ports on the same
// placeable since those are packed tighter.
const PORT_SNAP_RADIUS_WORLD = 1.0;

// Run-wiring corridor sampling. The corridor is the polyline the cursor
// actually traced, so it needs a floor on sample spacing (mouse jitter) and a
// ceiling on point count (an unbounded drag re-plans against it every move).
const RUN_TRACE_MIN_STEP = 0.5;      // tiles
const RUN_TRACE_MAX_POINTS = 256;

function snapQ(v) { return Math.round(v * 4) / 4; }
function snapPath(path) {
  return path.map(p => ({ col: snapQ(p.col), row: snapQ(p.row) }));
}

export class UtilityLineInputController {
  constructor({ game, renderer }) {
    this.game = game;
    this.renderer = renderer;

    this._utilityType = null;
    this._drawing = false;
    this._drawStart = null;  // {placeableId, portName, worldPos: {x, z}}
    this._drawPath = [];     // tile-coord path for preview
    this._preferVerticalFirst = false;
    this._preview = null;    // { utilityType, path, color } while dragging
    this._hoverPort = null;  // { placeableId, portName, worldPos, utilityType }

    // Run-wiring (modifier held): the drag sweeps a corridor and every
    // compatible sink in it is wired to the anchor source in one gesture.
    this._runMode = false;
    this._runPlan = null;    // { stubs, totalSubL, skipped, cost } while dragging
    this._runTrace = [];     // tile points the cursor swept this drag
  }

  setUtilityType(type) {
    this._utilityType = type || null;
    this._cancelDraw();
    this._hoverPort = null;
  }

  isActive() {
    return this._drawing;
  }

  onHover(worldX, worldY) {
    if (!this._utilityType) return;
    // Expose hover port for the renderer (glowing-sphere highlight). Include
    // utilityType so the marker is colored per-descriptor even when not
    // mid-draw.
    const snap = this._snapToNearestPort(worldX, worldY);
    if (snap) snap.utilityType = this._utilityType;
    this._hoverPort = snap;
  }

  // Public: current utility type (null if no tool armed).
  get utilityType() { return this._utilityType; }

  // Public: start-anchor while mid-draw ({placeableId, portName, worldPos}).
  // Renderer uses this to skip the start port's indicator while dragging.
  get drawStart() { return this._drawStart; }

  // Public: live Manhattan preview path while dragging (null otherwise).
  get preview() { return this._preview; }

  // Public: the port the cursor is snapped to (null if none).
  get hoverPort() { return this._hoverPort; }

  // Public: the run-wiring plan the current drag would commit, or null when
  // the drag is an ordinary single line. The tool layer reads `stubs.length`
  // and `cost` for the drag tooltip.
  get runPlan() { return this._runPlan; }

  onMouseDown(worldX, worldY, button, modifiers = {}) {
    if (!this._utilityType || button !== 0) return false;
    // Prefer a port snap if the cursor is near one; otherwise start an
    // open-ended draw at the cursor's subtile. Either way, consume the click
    // since the utility-line tool is armed.
    const snap = this._snapToNearestPort(worldX, worldY);
    this._drawing = true;
    if (snap) {
      this._drawStart = snap;
    } else {
      const w = this._isoFloatToWorld(worldX, worldY);
      this._drawStart = { open: true, worldPos: w };
    }
    this._drawPath = [];
    this._hoverPort = null;
    this._runMode = !!modifiers.run;
    this._runPlan = null;
    // The run corridor follows what the cursor actually traced, not the
    // Manhattan preview: "wire everything this drag passed" is only
    // predictable if it means the path the player's hand drew.
    this._runTrace = [this._anchorTile()];
    this._preview = {
      utilityType: this._utilityType,
      path: [],
      color: UTILITY_TYPES[this._utilityType]?.color || '#ffffff',
    };
    return true;
  }

  onMouseMove(worldX, worldY, modifiers = {}) {
    if (!this._drawing) return;
    const wasRunMode = this._runMode;
    if (modifiers.run !== undefined) this._runMode = !!modifiers.run;
    // Update hover-port during drag so the candidate end port highlights.
    const snap = this._snapToNearestPort(worldX, worldY);
    if (snap) snap.utilityType = this._utilityType;
    this._hoverPort = snap;
    const grew = this._traceCursor(worldX, worldY);
    const geom = this._dragGeometry(worldX, worldY, snap);
    this._drawPath = geom.path || [];
    // Re-plan only when the corridor moved or the modifier flipped — planning
    // walks every endpoint and dry-runs the validator, too much for every
    // sub-pixel mousemove.
    if (grew || this._runMode !== wasRunMode) this._runPlan = this._planRun();
    // In run mode the preview IS the set of stubs that will be committed —
    // showing the drag line too would advertise geometry that never lands.
    const previewPath = (this._runPlan && this._runPlan.stubs.length > 0)
      ? runPreviewPath(this._runPlan.stubs)
      : this._drawPath;
    this._preview = {
      utilityType: this._utilityType,
      path: previewPath,
      color: UTILITY_TYPES[this._utilityType]?.color || '#ffffff',
    };
  }

  onMouseUp(worldX, worldY, button, modifiers = {}) {
    if (!this._drawing || button !== 0) {
      this._cancelDraw();
      return !!this._drawing;
    }
    if (modifiers.run !== undefined) this._runMode = !!modifiers.run;
    this._traceCursor(worldX, worldY);
    // End may be a port, an existing line's subtile (detected via overlap
    // during discovery), or just empty space.
    const endSnap = this._snapToNearestPort(worldX, worldY);
    const geom = this._dragGeometry(worldX, worldY, endSnap);
    const endAnchor = geom.endAnchor;
    // Run-wiring wins over the single-line commit whenever it found something
    // to wire; an empty plan falls through so a modifier-held miss still
    // behaves like a normal drag.
    const plan = this._planRun();
    if (plan && plan.stubs.length > 0) {
      this._commitRun(plan);
      this._cancelDraw();
      return true;
    }
    const path = geom.path;
    if (path) {
      const startRef = this._drawStart.open
        ? null
        : { placeableId: this._drawStart.placeableId, portName: this._drawStart.portName };
      const endRef = endAnchor.open
        ? null
        : { placeableId: endAnchor.placeableId, portName: endAnchor.portName };
      // Trivially self-looping port-to-same-port commits are the gesture's
      // validate step. addLine then runs its own validation (port direction,
      // overlap, port already taken, …) and returns null on rejection, so
      // the gesture snapshots only when a line actually appeared.
      this.game.commitGesture({
        validate: () => !(startRef && endRef
          && startRef.placeableId === endRef.placeableId
          && startRef.portName === endRef.portName),
        mutate: () => this.game.utilityLineSystem.addLine({
          utilityType: this._utilityType,
          start: startRef,
          end: endRef,
          path,
        }),
      });
    }
    this._cancelDraw();
    return true;
  }

  onEscape() { this._cancelDraw(); }

  _cancelDraw() {
    this._drawing = false;
    this._drawStart = null;
    this._drawPath = [];
    this._preview = null;
    this._runMode = false;
    this._runPlan = null;
    this._runTrace = [];
  }

  /** The draw anchor as a snapped tile point. */
  _anchorTile() {
    const raw = this._worldToTile(this._drawStart.worldPos);
    return { col: snapQ(raw.col), row: snapQ(raw.row) };
  }

  /** Cursor iso-pixels → snapped tile point. */
  _cursorTile(worldX, worldY) {
    const c = this._isoFloatToTile(worldX, worldY);
    return { col: snapQ(c.col), row: snapQ(c.row) };
  }

  /**
   * Extend the run corridor with the cursor's current tile. Returns whether
   * the corridor actually grew — planning is O(sinks × existing lines), so it
   * only reruns on a real step. Points closer than half a tile to the last one
   * are dropped (mouse jitter would otherwise make the corridor thousands of
   * segments long on one drag).
   */
  _traceCursor(worldX, worldY) {
    if (!this._runTrace || this._runTrace.length === 0) return false;
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return false;
    const pt = this._cursorTile(worldX, worldY);
    const last = this._runTrace[this._runTrace.length - 1];
    if (Math.hypot(pt.col - last.col, pt.row - last.row) < RUN_TRACE_MIN_STEP) return false;
    // Past the cap the tail coarsens rather than the head being dropped: the
    // anchor end of the corridor must survive an arbitrarily long drag.
    if (this._runTrace.length >= RUN_TRACE_MAX_POINTS) this._runTrace[this._runTrace.length - 1] = pt;
    else this._runTrace.push(pt);
    return true;
  }

  /**
   * Shared drag geometry for move and up: cursor snapped to a port when it is
   * near one, start + end quantised to the 0.25 sub-tile grid, and the
   * Manhattan path between them (null when the drag has not left the anchor).
   */
  _dragGeometry(worldX, worldY, snap) {
    const startTileRaw = this._worldToTile(this._drawStart.worldPos);
    const startTile = { col: snapQ(startTileRaw.col), row: snapQ(startTileRaw.row) };
    const endAnchor = snap
      ? snap
      : { open: true, worldPos: this._isoFloatToWorld(worldX, worldY) };
    const endTileRaw = this._worldToTile(endAnchor.worldPos);
    const endTile = { col: snapQ(endTileRaw.col), row: snapQ(endTileRaw.row) };
    const rawPath = buildManhattanPath(startTile, endTile, {
      preferVerticalFirst: this._preferVerticalFirst,
    });
    return {
      startTile,
      endTile,
      endAnchor,
      path: rawPath ? snapPath(rawPath) : null,
    };
  }

  /**
   * The run-wiring plan for the drag as it stands, or null when this drag is
   * an ordinary single line (modifier not held, or the anchor is not a source
   * port). Priced here so both the tooltip and the commit read one number.
   */
  _planRun() {
    if (!this._runMode || !this._drawStart || this._drawStart.open) return null;
    const trace = this._runTrace;
    if (!Array.isArray(trace) || trace.length < 2) return null;
    const plan = planUtilityRun(this.game.state, {
      utilityType: this._utilityType,
      source: {
        placeableId: this._drawStart.placeableId,
        portName: this._drawStart.portName,
      },
      runPath: trace,
      preferVerticalFirst: this._preferVerticalFirst,
    });
    plan.cost = this._runCost(plan.totalSubL);
    return plan;
  }

  /** Cost of `subL` sub-units of the armed utility. Seam for tests. */
  _runCost(subL) {
    return runWiringCost(this._utilityType, subL);
  }

  /**
   * Commit the whole run as ONE gesture: affordability is checked before
   * anything mutates, every stub lands inside a single undo entry, and the
   * charge is for length that actually committed (the plan pre-validates each
   * stub with validateDrawLine, so a short-fall means a stub was refused
   * between plan and commit — hand back the difference rather than keep it).
   */
  _commitRun(plan) {
    const game = this.game;
    const planCost = plan.cost;
    const committed = [];
    game.commitGesture({
      cost: planCost || undefined,
      mutate: () => {
        let subL = 0;
        for (const stub of plan.stubs) {
          const id = game.utilityLineSystem.addLine({
            utilityType: this._utilityType,
            start: stub.start,
            end: stub.end,
            path: stub.path,
          });
          if (id) { committed.push(id); subL += stub.subL; }
        }
        if (planCost && committed.length) {
          const actual = this._runCost(subL) || {};
          for (const [r, amount] of Object.entries(planCost)) {
            const back = amount - (actual[r] || 0);
            if (back > 0) game.state.resources[r] += back;
          }
        }
        return committed.length > 0 ? committed : null;
      },
      failed: (result) => !result,
    });
    if (committed.length > 0) {
      const label = UTILITY_TYPES[this._utilityType]?.displayName || this._utilityType;
      game.log(`${label}: wired ${committed.length} component${committed.length === 1 ? '' : 's'}`, 'good');
    }
    return committed;
  }

  _snapToNearestPort(worldX, worldY) {
    const state = this.game.state;
    const lines = state.utilityLines;
    const cursorWorld = this._isoFloatToWorld(worldX, worldY);
    let best = null;
    let bestDist = PORT_SNAP_RADIUS_WORLD;
    // Endpoints, not state.placeables: components carried on beam pipes
    // (cavities, cryomodules, BPMs) declare utility ports too, and hit-testing
    // placeables alone made those ports impossible to grab.
    for (const placeable of listUtilityEndpoints(state)) {
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
