// src/input/UtilityLineInputController.js
//
// Input controller for drawing utility lines between ports on placeables.
// Parallel to BeamlineInputController but scoped to the utility-line system:
//   - Stores the current utility type (e.g. 'powerCable').
//   - Snaps start/end to ports whose spec.utility matches the current type.
//   - Soft cords and hoses preserve the player's freehand stroke.
//   - Fabricated services use the flexible quarter-tile orthogonal router.
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
import { availablePorts, portApproachVec, portWorldPosition } from '../utility/ports.js';
import { portAnchor3D } from '../utility/port-anchors.js';
import {
  buildPortRoutedPaths,
  findObstacleAwareRoute,
  pathLengthSubUnits,
  expandPath,
} from '../utility/line-geometry.js';
import { validateDrawLine } from '../utility/line-drawing.js';
import { buildUtilityRouteObstacles } from '../utility/route-obstacles.js';
import {
  snapUtilityRouteCoordinate,
  usesFlexibleSubtileRouting,
} from '../utility/routing-contract.js';
import { reasonMessage } from '../utility/UtilityLineSystem.js';
import { UTILITY_TYPES, utilityLineHeight } from '../utility/registry.js';
import { universalBusLane } from '../utility/universal-bus-layout.js';
import {
  lineWaterCircuit,
  portWaterCircuit,
  waterCircuitColor,
} from '../utility/water-circuits.js';
import { listUtilityEndpoints, findUtilityEndpoint } from '../utility/utility-endpoints.js';
import { planUtilityRun, runPreviewPath, runWiringCost } from './utility-run-wiring.js';
import {
  applyAutomaticWallPassThroughPlanToState,
  combineConstructionCosts,
  executeAutomaticWallPassThroughPlan,
  executeAutomaticWallPassThroughPlans,
  planAutomaticWallPassThroughs,
} from '../utility/automatic-wall-feedthroughs.js';
import { isoToGridFloat } from '../renderer/grid.js';
import {
  cablePathLengthSubUnits,
  isHvCableTensionSpan,
  isSoftCable,
  roundedCableTilePath,
  sanitizeCablePath,
  SOFT_CABLE_MAX_POINTS,
} from '../utility/soft-cable.js';

// Snap tolerance between cursor and a port's world position, in world meters.
// 1.5 m gives a deliberately magnetic, but still local, pickup/drop zone.
// The nearest compatible fitting wins, so closely spaced ports remain usable.
const PORT_SNAP_RADIUS_WORLD = 1.5;

// Grab radius around a port's PROJECTED anchor, in viewport pixels. Sized to
// the fitting the renderer draws there plus a forgiving margin. Thirty pixels
// gives open ports a genuinely magnetic target during both pickup and drop;
// crowded connectors remain separable because _snapToNearestPort always picks
// the nearest candidate. Pixels, not metres, because this is a hand-eye budget
// — it must not shrink as the player zooms out.
const PORT_SNAP_RADIUS_PX = 42;

// How close the cursor has to be to an existing line of the same utility to
// grab it, in tiles. Tighter than the port radius: ports are the primary
// target and a trunk usually runs right past one, so a generous tap radius
// would steal clicks meant for the port at the end of it.
const TAP_SNAP_RADIUS_TILES = 0.65;
// Rack access points are one tile apart. A radius above half that pitch makes
// the whole visible rack magnetic instead of leaving frustrating dead strips
// between adjacent rungs when mesh raycasting is unavailable.
const BUS_SNAP_RADIUS_TILES = 0.65;

// Run-wiring corridor sampling. The corridor is the polyline the cursor
// actually traced, so it needs a floor on sample spacing (mouse jitter) and a
// ceiling on point count (an unbounded drag re-plans against it every move).
const RUN_TRACE_MIN_STEP = 0.5;      // tiles
const RUN_TRACE_MAX_POINTS = 256;

// Flexible cords and hoses follow the hand rather than the routing grid. One
// half-subtile (1/8 tile, 25 cm in-world) between committed samples preserves
// deliberate small bends without storing one point per mouse event. A live
// endpoint follows the cursor between samples; the cap bounds save size and
// preview rebuild cost while covering a 128-tile drawn run.
export const SOFT_CABLE_TRACE_STEP = 0.125; // tiles

// How far down the router's ranking a drag will look for a route the board
// accepts. See _dragGeometry: each step costs a full validateDrawLine, which
// expands every same-type line on the board, and this runs per mousemove.
const MAX_ROUTE_CANDIDATES = 6;

function snapQ(v) { return snapUtilityRouteCoordinate(v); }
function snapPath(path) {
  return path.map(p => ({ col: snapQ(p.col), row: snapQ(p.row) }));
}

export class UtilityLineInputController {
  constructor({ game, renderer }) {
    this.game = game;
    this.renderer = renderer;

    this._utilityType = null;
    this._selectedWaterCircuit = null;
    this._drawing = false;
    this._drawStart = null;  // {placeableId, portName, worldPos: {x, z}}
    this._drawPath = [];     // tile-coord path for preview
    this._preferVerticalFirst = false;
    this._preview = null;    // { utilityType, path, color } while dragging
    this._dragReject = null; // validator reason the current drag would fail on
    this._hoverPort = null;  // { placeableId, portName, worldPos, utilityType }

    // Run-wiring (modifier held): the drag sweeps a corridor and every
    // compatible sink in it is wired to the anchor source in one gesture.
    this._runMode = false;
    this._runPlan = null;    // { stubs, totalSubL, skipped, cost } while dragging
    this._runTrace = [];     // tile points the cursor swept this drag
    this._cableTrace = [];   // unsnapped hand path for flexible-line geometry
  }

  setUtilityType(type, waterCircuit = null) {
    this._utilityType = type || null;
    // Water temperature belongs to the connected equipment port, never to a
    // cosmetic palette choice. Keep accepting the second argument for tool
    // and save compatibility, but deliberately do not constrain the gesture.
    this._selectedWaterCircuit = null;
    this._cancelDraw();
    this._hoverPort = null;
  }

  /** Publish a non-port-routed preview (continuous manifold placement). */
  setExternalPreview(preview) {
    this._preview = preview || null;
    this._hoverPort = null;
  }

  isActive() {
    return this._drawing;
  }

  // Which leg of a one-bend path comes first. The player's choice, bound to R
  // by UtilityLineTool: _dragGeometry tries this order first and only falls
  // back to the other when the ports make it illegal, so the flip is visible
  // whenever there is a real choice to make.
  get preferVerticalFirst() { return this._preferVerticalFirst; }

  setPreferVerticalFirst(v) { this._preferVerticalFirst = !!v; }

  togglePreferVerticalFirst() { this._preferVerticalFirst = !this._preferVerticalFirst; }

  onHover(worldX, worldY, screen) {
    if (!this._utilityType) return;
    // Expose hover port for the renderer (glowing-sphere highlight). Include
    // utilityType so the marker is colored per-descriptor even when not
    // mid-draw.
    const snap = this._snapToNearest(worldX, worldY, screen);
    if (snap) snap.utilityType = this._utilityType;
    this._hoverPort = snap;
  }

  // Public: current utility type (null if no tool armed).
  get utilityType() { return this._utilityType; }

  // Compatibility accessor. Water tools no longer preselect a circuit.
  get waterCircuit() { return this._selectedWaterCircuit; }

  // Public: start-anchor while mid-draw ({placeableId, portName, worldPos}).
  // Renderer uses this to skip the start port's indicator while dragging.
  get drawStart() { return this._drawStart; }

  // Public: live Manhattan preview path while dragging (null otherwise).
  get preview() { return this._preview; }

  // Public: the port the cursor is snapped to (null if none).
  get hoverPort() { return this._hoverPort; }

  // Used by the idle-world gesture: before a utility tool is selected, find
  // whichever visible, available port the player clicked and report its type.
  findPortAt(worldX, worldY, screen) {
    return this._snapToNearestPort(worldX, worldY, screen, null);
  }

  // Public: player-facing reason the drag as it stands would be REFUSED, or
  // null when it would commit. Read by the tool for the drag tooltip.
  get dragReject() {
    return this._dragReject ? reasonMessage(this._dragReject) : null;
  }

  // Public: the run-wiring plan the current drag would commit, or null when
  // the drag is an ordinary single line. The tool layer reads `stubs.length`
  // and `cost` for the drag tooltip.
  get runPlan() { return this._runPlan; }

  // Plane used by UtilityLineTool while a service is being drawn. Fixed rigid
  // utilities always return their facility datum; flexible bus channels may
  // temporarily supply the rack slot height through the preview.
  get drawHeight() {
    const previewHeight = this._preview?.routeHeightMeters;
    return utilityLineHeight(
      this._utilityType,
      Number.isFinite(previewHeight) ? previewHeight : null,
    );
  }

  // Public: what the gesture as it stands would be charged, in funding — the
  // run plan's total, or the single line's own length. Both commits price
  // through _wiringCost, so the tooltip cannot quote a number the commit
  // does not take.
  get dragCost() {
    if (this._runPlan && this._runPlan.stubs.length > 0) {
      return (this._runPlan.cost && this._runPlan.cost.funding) || 0;
    }
    // The carrier itself was paid for when it was built, and an ordinary
    // source/load branch already populates its lane without a second backbone
    // charge. Keep the explicit tap-to-tap lane gesture economically identical.
    if (this._sameBusLaneGesture()) return 0;
    const cableSubL = isSoftCable(this._utilityType)
      ? cablePathLengthSubUnits(this._cableTrace)
      : 0;
    const c = this._wiringCost(cableSubL || pathLengthSubUnits(this._drawPath));
    return (c && c.funding) || 0;
  }

  onMouseDown(worldX, worldY, button, modifiers = {}, screen) {
    if (!this._utilityType || button !== 0) return false;
    // Prefer a port snap if the cursor is near one; otherwise start an
    // open-ended draw at the cursor's subtile. Either way, consume the click
    // since the utility-line tool is armed.
    const snap = this._snapToNearest(worldX, worldY, screen);
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
    this._cableTrace = isSoftCable(this._utilityType)
      ? [this._worldToTile(this._drawStart.worldPos)]
      : [];
    this._preview = {
      utilityType: this._utilityType,
      path: [],
      valid: true,
      waterCircuit: snap?.waterCircuit || null,
      color: this._lineColor(snap?.waterCircuit),
    };
    return true;
  }

  onMouseMove(worldX, worldY, modifiers = {}, screen) {
    if (!this._drawing) return;
    const wasRunMode = this._runMode;
    if (modifiers.run !== undefined) this._runMode = !!modifiers.run;
    // Update hover-port during drag so the candidate end port highlights.
    const snap = this._snapToNearest(worldX, worldY, screen);
    if (snap) snap.utilityType = this._utilityType;
    this._hoverPort = snap;
    const grew = this._traceCursor(worldX, worldY);
    this._traceSoftCable(worldX, worldY, snap);
    const geom = this._dragGeometry(worldX, worldY, snap);
    this._drawPath = geom.path || [];
    // Re-plan only when the corridor moved or the modifier flipped — planning
    // walks every endpoint and dry-runs the validator, too much for every
    // sub-pixel mousemove.
    if (grew || this._runMode !== wasRunMode) this._runPlan = this._planRun();
    // In run mode the preview IS the set of stubs that will be committed —
    // showing the drag line too would advertise geometry that never lands.
    const populatingBusLane = !!geom.populateBusId;
    const previewPath = (this._runPlan && this._runPlan.stubs.length > 0)
      ? runPreviewPath(this._runPlan.stubs)
      : (!populatingBusLane && isSoftCable(this._utilityType) && this._cableTrace.length >= 2
          ? this._cableTrace
          : this._drawPath);
    this._preview = {
      utilityType: this._utilityType,
      path: previewPath,
      valid: !!(this._runPlan?.stubs?.length) || !this._dragReject,
      // A bulk run preview is a flattened set of independent stubs, so it has
      // no single start/end whose 3D dogleg can be shown. Ordinary RF draws do
      // and should preview the same adaptive drops the commit will build.
      endpointTransitions: !populatingBusLane
        && !(this._runPlan && this._runPlan.stubs.length > 0),
      cablePath: !populatingBusLane && isSoftCable(this._utilityType) && !this._runPlan
        ? this._cableTrace.map(point => ({ ...point }))
        : null,
      busLane: populatingBusLane,
      startAnchor: this._drawStart?.anchor || null,
      endAnchor: snap?.anchor || null,
      // A suspended span needs hardware carrying tension at both ends. A pole,
      // rack, wall fitting, or roof insulator must not pull the slack out of a
      // cable whose other end is an ordinary equipment plug (or the cursor).
      tensioned: this._utilityType === 'hvCable' && isHvCableTensionSpan(
        [this._drawStart, snap].map(handle => {
          const endpoint = handle?.placeableId
            ? findUtilityEndpoint(this.game.state, handle.placeableId) : null;
          return { def: COMPONENTS[endpoint?.type], portName: handle?.portName };
        }),
      ),
      routeHeightMeters: this._runPlan?.stubs?.[0]?.routeHeightMeters
        ?? geom.routeHeightMeters,
      waterCircuit: geom.waterCircuit || null,
      color: this._lineColor(geom.waterCircuit),
    };
  }

  onMouseUp(worldX, worldY, button, modifiers = {}, screen) {
    if (!this._drawing || button !== 0) {
      this._cancelDraw();
      return !!this._drawing;
    }
    if (modifiers.run !== undefined) this._runMode = !!modifiers.run;
    this._traceCursor(worldX, worldY);
    // End may be a port, an existing line's subtile (detected via overlap
    // during discovery), or just empty space.
    const endSnap = this._snapToNearest(worldX, worldY, screen);
    this._traceSoftCable(worldX, worldY, endSnap, true);
    const geom = this._dragGeometry(worldX, worldY, endSnap);
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
      const { startRef, endRef } = geom;
      const populatingBusLane = !!geom.populateBusId;
      const cablePath = !populatingBusLane && isSoftCable(this._utilityType)
        ? sanitizeCablePath(this._cableTrace, SOFT_CABLE_MAX_POINTS)
        : null;
      const pricedSubL = cablePath && cablePath.length >= 2
        ? cablePathLengthSubUnits(cablePath)
        : pathLengthSubUnits(path);
      // Trivially self-looping port-to-same-port commits are the gesture's
      // validate step. addLine then runs its own validation (port direction,
      // overlap, port already taken, …) and returns null on rejection, so
      // the gesture snapshots only when a line actually appeared (and
      // commitGesture hands the charge back).
      //
      // Priced on the SAME rule as a run-wiring drag: per sub-unit of the path
      // that commits. A free single line would make the bulk gesture the only
      // one that costs anything, so the cheapest way to wire a facility would
      // be one line at a time — and it would make a distribution bus (priced
      // to break even against the individual runs it replaces) strictly worse
      // than the runs.
      const line = {
        start: startRef, end: endRef, path, cablePath,
        tapLineIds: geom.tapLineIds,
        routeHeightMeters: geom.routeHeightMeters,
        waterCircuit: geom.waterCircuit,
      };
      const wallPlan = populatingBusLane || geom.busTapIds.start || geom.busTapIds.end
        ? null
        : planAutomaticWallPassThroughs(this.game, {
            utilityType: this._utilityType, ...line,
          });
      if (wallPlan && !wallPlan.ok) {
        this.game.log(`Can't place utility line: ${reasonMessage(wallPlan.reason)}`, 'bad');
        this._cancelDraw();
        return true;
      }
      this.game.commitGesture({
        validate: () => !(startRef && endRef
          && startRef.placeableId === endRef.placeableId
          && startRef.portName === endRef.portName),
        cost: populatingBusLane ? undefined : (combineConstructionCosts(
          this._wiringCost(pricedSubL), wallPlan?.fittingCost,
        ) || undefined),
        mutate: () => {
          return geom.busTapIds.start || geom.busTapIds.end
            ? this.game.utilityBusSystem?.connectLine({
                utilityType: this._utilityType, line, busTapIds: geom.busTapIds,
              })
            : executeAutomaticWallPassThroughPlan(this.game, wallPlan);
        },
      });
    }
    this._cancelDraw();
    return true;
  }

  onEscape() { this._cancelDraw(); }

  _cancelDraw() {
    this._drawing = false;
    this._dragReject = null;
    this._drawStart = null;
    this._drawPath = [];
    this._preview = null;
    this._runMode = false;
    this._runPlan = null;
    this._runTrace = [];
    this._cableTrace = [];
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

  /** Record the actual unsnapped hand path used to render a flexible run. */
  _traceSoftCable(worldX, worldY, snap, final = false) {
    if (!isSoftCable(this._utilityType) || this._runMode) return false;
    if (!Array.isArray(this._cableTrace) || this._cableTrace.length === 0) return false;
    const raw = snap?.worldPos
      ? this._worldToTile(snap.worldPos)
      : this._isoFloatToTile(worldX, worldY);
    if (!Number.isFinite(raw.col) || !Number.isFinite(raw.row)) return false;
    const point = { col: raw.col, row: raw.row };
    const trace = this._cableTrace;
    const last = trace[trace.length - 1];
    if (Math.hypot(point.col - last.col, point.row - last.row) < 1e-6) return false;

    if (trace.length === 1) {
      trace.push(point);
      return true;
    }

    // The last point is live, not committed. Measure from the point before it
    // so a slow stream of tiny mouse moves accumulates distance instead of
    // repeatedly replacing itself forever. Fill every half-subtile crossed in
    // one fast mouse move so collision and rendering cannot skip thin objects.
    trace.pop();
    const anchor = trace[trace.length - 1];
    const dc = point.col - anchor.col;
    const dr = point.row - anchor.row;
    const distance = Math.hypot(dc, dr);
    const steps = Math.floor(distance / SOFT_CABLE_TRACE_STEP);
    for (let i = 1; i <= steps && trace.length < SOFT_CABLE_MAX_POINTS - 1; i++) {
      const along = Math.min(i * SOFT_CABLE_TRACE_STEP, distance);
      trace.push({
        col: anchor.col + dc * along / distance,
        row: anchor.row + dr * along / distance,
      });
    }
    const endpoint = trace[trace.length - 1];
    if (final && endpoint
      && Math.hypot(point.col - endpoint.col, point.row - endpoint.row) < 1e-6) return true;
    if (trace.length < SOFT_CABLE_MAX_POINTS) trace.push(point);
    else trace[trace.length - 1] = point;
    return true;
  }

  /**
   * Shared drag geometry for move and up: cursor snapped to a port when it is
   * near one, start + end quantised to the 0.25 sub-tile grid, and the path
   * between them (null when the drag has not left the anchor).
   *
   * Routing is deliberately direction-agnostic: fittings still have authored
   * sides for credible placement and rendering, but utility runs may turn away
   * from any fitting. This makes a nearby port a forgiving connection target
   * rather than a one-way constraint.
   *
   * Two jobs are being done here and they belong to different owners. Is this
   * route a SENSIBLE shape — does it double back, how many corners does it turn
   * — is geometry, and the router ranks candidates on it. Is this route LEGAL —
   * does it lie on top of cable that is already down — needs the board, which
   * the router cannot see. So the router hands over its whole ranking and this
   * walks it, taking the best shape the validator accepts.
   *
   * That walk is why this cannot collapse to one call. Overlap_same_type
   * genuinely differs between shapes,
   * and the alternate order was often the one clear of existing runs. Dropping
   * to a single candidate would have made a hall get harder to wire with every
   * cable laid. Walking the ranking is strictly better than the old pair: same
   * recovery, more shapes to recover into, and the shapes are ordered by
   * quality instead of by which bend the player last pressed R for.
   *
   * When nothing validates the FIRST candidate is returned anyway, along with
   * the first rejection reason: the preview then shows the route the commit
   * will attempt, and addLine reports the real reason rather than the gesture
   * silently doing nothing.
   */
  _dragGeometry(worldX, worldY, snap) {
    const startTileRaw = this._worldToTile(this._drawStart.worldPos);
    const startTile = { col: snapQ(startTileRaw.col), row: snapQ(startTileRaw.row) };
    const endAnchor = snap
      ? snap
      : { open: true, worldPos: this._isoFloatToWorld(worldX, worldY) };
    const endTileRaw = this._worldToTile(endAnchor.worldPos);
    const endTile = { col: snapQ(endTileRaw.col), row: snapQ(endTileRaw.row) };
    const startRef = this._anchorRef(this._drawStart);
    const endRef = this._anchorRef(endAnchor);
    const waterCircuit = this._waterCircuitForAnchors(this._drawStart, endAnchor);
    // A tap end is an open end that is allowed to touch one specific line, at
    // exactly the subtile it lands on. Everything else about it is ordinary.
    const tapLineIds = {
      start: this._drawStart && this._drawStart.tap ? this._drawStart.lineId : null,
      end: endAnchor && endAnchor.tap ? endAnchor.lineId : null,
    };
    const busTapIds = {
      start: this._drawStart?.busTap ? this._drawStart.busId : null,
      end: endAnchor?.busTap ? endAnchor.busId : null,
    };
    const populateBusId = busTapIds.start
      && busTapIds.start === busTapIds.end
      ? busTapIds.start
      : null;
    // A drag between two access points on one carrier means "lay this service
    // in its designated lane". Treating it as an ordinary open-ended line
    // would create the lane and then try to overlap it with a duplicate branch;
    // the validator correctly rejects that duplicate and the gesture rolls the
    // lane back, which is why the player previously saw nothing appear.
    if (populateBusId) {
      const moved = Math.abs(startTile.col - endTile.col)
        + Math.abs(startTile.row - endTile.row) > 1e-9;
      const lane = universalBusLane(this._utilityType);
      this._dragReject = null;
      return {
        startTile, endTile, endAnchor, startRef, endRef, tapLineIds, busTapIds,
        populateBusId,
        waterCircuit,
        path: moved ? [startTile, endTile] : null,
        routeHeightMeters: lane?.runY ?? null,
      };
    }
    for (const end of ['start', 'end']) {
      if (!busTapIds[end]) continue;
      tapLineIds[end] = this.game.utilityBusSystem?.channelLineId(
        busTapIds[end], this._utilityType,
      ) || null;
    }

    const descriptor = UTILITY_TYPES[this._utilityType] || {};
    const cablePath = isSoftCable(this._utilityType) && !this._runMode
      ? this._cableTrace
      : null;
    const startVec = this._portVec(this._drawStart);
    const endVec = this._portVec(endAnchor);
    const routeOpts = {
      preferVerticalFirst: this._preferVerticalFirst,
      allowZeroLength: true,
    };
    const candidates = buildPortRoutedPaths(
      // Every utility can form a zero-plan-length fitting between co-located
      // anchors; every longer run may turn immediately at the fitting.
      startTile, startVec, endTile, endVec, routeOpts);

    let chosen = null;
    let chosenRouteHeight = null;
    let reason = null;
    let freeformPhysicalBlock = false;
    const fallback = candidates.length > 0 ? snapPath(candidates[0]) : null;
    // This runs on every mousemove, and validateDrawLine walks the whole board
    // expanding every same-type line to sub-tile resolution. The ranking can be
    // a dozen routes long; validating all of them on a drag across a wired hall
    // is a per-frame cost the player feels. The first few are the ones worth
    // having anyway — past that the shapes are getting long and ugly enough
    // that refusing and saying why beats committing one of them.
    const limit = Math.min(candidates.length, MAX_ROUTE_CANDIDATES);
    for (let i = 0; i < limit; i++) {
      const path = snapPath(candidates[i]);
      const res = validateDrawLine(this.game.state, {
        utilityType: this._utilityType, start: startRef, end: endRef, path, tapLineIds,
        cablePath, waterCircuit, allowAutomaticWallPassThrough: true,
      });
      if (res.ok) {
        chosen = path;
        chosenRouteHeight = res.line.routeHeightMeters ?? null;
        break;
      }
      // The reason shown is the FIRST failure: it is the one that explains why
      // the route the player is looking at — the preview, which is candidate
      // zero — would be refused.
      if (reason === null) reason = res.reason;
      // Every compatibility candidate carries the same visible freehand body.
      // If that body hits a wall or solid model, trying five more hidden routes
      // (and then A*) cannot change the answer; the player must draw around it.
      if (cablePath?.length >= 2
          && (res.reason === 'blocked_by_equipment'
            || res.reason === 'wall_pass_through_required')) {
        freeformPhysicalBlock = true;
        break;
      }
    }
    // Generic port-aligned L/U candidates are intentionally cheap. If measured
    // 3D geometry or an installed run rejects them, every utility gets the same
    // bounded quarter-tile A* recovery pass. Empty space beneath a component is
    // absent from the obstacle map, so the best route may pass directly under
    // beamline hardware; a real collision produces a tidy perimeter wrap.
    let routedFallback = fallback;
    if (!chosen && !freeformPhysicalBlock && usesFlexibleSubtileRouting(descriptor)) {
      const routeHeightMeters = descriptor.fixedRouteHeight
        ? utilityLineHeight(
            this._utilityType,
            descriptor.runHeightsByWaterCircuit?.[waterCircuit]
              ?? descriptor.runHeightMeters,
          )
        : null;
      const obstacles = buildUtilityRouteObstacles(this.game.state, this._utilityType, {
        startRef, endRef,
        routeHeightMeters,
      });
      const detour = findObstacleAwareRoute(
        startTile, startVec, endTile, endVec, {
          ...routeOpts,
          blocked: obstacles.isBlocked,
          bendPenalty: descriptor.bendPenalty,
          searchMarginTiles: descriptor.searchMarginTiles,
          maxExpanded: descriptor.maxRouteExpanded,
        });
      if (detour) {
        const path = snapPath(detour);
        const res = validateDrawLine(this.game.state, {
          utilityType: this._utilityType, start: startRef, end: endRef, path, tapLineIds,
          cablePath, waterCircuit, allowAutomaticWallPassThrough: true,
        });
        if (res.ok) {
          chosen = path;
          chosenRouteHeight = res.line.routeHeightMeters ?? null;
        }
        else if (!routedFallback) {
          routedFallback = path;
          if (reason === null) reason = res.reason;
        }
      }
    }
    // Why the gesture would be refused, for the drag tooltip. The commit path
    // logs this too, but the log has no on-screen surface — leaving "release
    // and nothing happens" as the only feedback the player ever got.
    if (reason === null && !routedFallback && startRef && endRef) reason = 'invalid_path';
    this._dragReject = chosen ? null : reason;
    return {
      startTile, endTile, endAnchor, startRef, endRef, tapLineIds, busTapIds,
      waterCircuit,
      path: chosen || routedFallback,
      routeHeightMeters: chosenRouteHeight
        ?? (descriptor.fixedRouteHeight
          ? utilityLineHeight(
              this._utilityType,
              descriptor.runHeightsByWaterCircuit?.[waterCircuit]
                ?? descriptor.runHeightMeters,
            )
          : null),
    };
  }

  /** {placeableId, portName} for a port-anchored draw end, null when open. */
  _anchorRef(anchor) {
    if (!anchor || anchor.open || !anchor.placeableId) return null;
    return { placeableId: anchor.placeableId, portName: anchor.portName };
  }

  _waterCircuitForRefs(...refs) {
    if (this._selectedWaterCircuit) return this._selectedWaterCircuit;
    for (const ref of refs) {
      if (!ref) continue;
      const endpoint = findUtilityEndpoint(this.game.state, ref.placeableId);
      const spec = COMPONENTS[endpoint?.type]?.ports?.[ref.portName];
      const circuit = portWaterCircuit(spec);
      if (circuit) return circuit;
    }
    return null;
  }

  /** Water circuit carried by a tapped line or an anchored equipment port. */
  _waterCircuitForAnchors(...anchors) {
    for (const anchor of anchors) {
      if (anchor?.waterCircuit) return anchor.waterCircuit;
    }
    return this._waterCircuitForRefs(...anchors.map(anchor => this._anchorRef(anchor)));
  }

  _lineColor(waterCircuit = this._selectedWaterCircuit) {
    const descriptor = UTILITY_TYPES[this._utilityType];
    if ((this._utilityType === 'waterSupplyPipe' || this._utilityType === 'coolingWater')
        && waterCircuit) {
      return waterCircuitColor(waterCircuit, descriptor?.color || '#ffffff');
    }
    return descriptor?.color || '#ffffff';
  }

  _waterCircuitForLine(line) {
    const authored = lineWaterCircuit(line);
    if (authored) return authored;
    const circuits = new Set();
    for (const ref of [line?.start, line?.end]) {
      if (!ref) continue;
      const endpoint = findUtilityEndpoint(this.game.state, ref.placeableId);
      const spec = COMPONENTS[endpoint?.type]?.ports?.[ref.portName];
      const circuit = portWaterCircuit(spec);
      if (circuit) circuits.add(circuit);
    }
    return circuits.size === 1 ? [...circuits][0] : null;
  }

  _sameBusLaneGesture(endAnchor = this._hoverPort) {
    const startBusId = this._drawStart?.busTap ? this._drawStart.busId : null;
    const endBusId = endAnchor?.busTap ? endAnchor.busId : null;
    return startBusId && startBusId === endBusId ? startBusId : null;
  }

  /** Port-facing geometry hint used only to rank otherwise equivalent routes. */
  _portVec(anchor) {
    const ref = this._anchorRef(anchor);
    if (!ref) return null;
    const endpoint = findUtilityEndpoint(this.game.state, ref.placeableId);
    const def = endpoint ? COMPONENTS[endpoint.type] : null;
    return def ? portApproachVec(endpoint, def, ref.portName) : null;
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
      waterCircuit: this._waterCircuitForAnchors(this._drawStart),
      preferVerticalFirst: this._preferVerticalFirst,
      // Bulk wiring must use the same endpoint geometry as an ordinary drag.
      // Otherwise Shift-drawing reintroduces the footprint-sized U-turns the
      // single-line path avoids.
      portPosition: (endpoint, def, portName) => {
        const anchor = portAnchor3D(endpoint, def, portName);
        return anchor
          ? { x: anchor.x, y: anchor.y, z: anchor.z }
          : portWorldPosition(endpoint, def, portName);
      },
    });
    plan.cost = this._wiringCost(plan.totalSubL);
    return plan;
  }

  /** Cost of `subL` sub-units of the armed utility — both commit paths price
   *  through here, so single lines and runs can never diverge. Seam for tests. */
  _wiringCost(subL) {
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
    const probeState = {
      ...game.state,
      placeables: [...(game.state.placeables || [])],
      utilityLines: new Map(game.state.utilityLines || []),
    };
    const probeGame = { ...game, state: probeState };
    const wallPlans = [];
    for (const stub of plan.stubs) {
      const wallPlan = planAutomaticWallPassThroughs(probeGame, {
        utilityType: this._utilityType,
        start: stub.start,
        end: stub.end,
        path: stub.path,
        routeHeightMeters: stub.routeHeightMeters,
        waterCircuit: stub.waterCircuit,
      });
      if (!wallPlan.ok || !applyAutomaticWallPassThroughPlanToState(probeState, wallPlan)) {
        game.log(`Can't wire run: ${reasonMessage(wallPlan.reason || 'invalid wall crossing')}`, 'bad');
        return [];
      }
      wallPlans.push(wallPlan);
    }
    const planCost = combineConstructionCosts(
      plan.cost,
      ...wallPlans.map(wallPlan => wallPlan.fittingCost),
    );
    const committed = [];
    game.commitGesture({
      cost: planCost || undefined,
      mutate: () => {
        const result = executeAutomaticWallPassThroughPlans(game, wallPlans);
        if (result) committed.push(...result.lineIds);
        return result;
      },
      failed: (result) => !result,
    });
    if (committed.length > 0) {
      const label = UTILITY_TYPES[this._utilityType]?.displayName || this._utilityType;
      game.log(`${label}: wired ${committed.length} component${committed.length === 1 ? '' : 's'}`, 'good');
    }
    return committed;
  }

  /**
   * What the cursor would grab: a port if one is close enough, otherwise a tap
   * on a committed line of this utility, otherwise nothing.
   *
   * Ports win ties — a port under the cursor is the more specific intent, and a
   * line usually runs right up to one.
   *
   * A tap is an OPEN end that happens to land on another line's subtile: the
   * spatial-union pass in network discovery already merges lines that share a
   * subtile, so a T-join needs no new endpoint concept in the data model. It
   * carries `lineId` only so the overlap check can be told which line it is
   * allowed to touch, at exactly that one point.
   */
  _snapToNearest(worldX, worldY, screen) {
    const port = this._snapToNearestPort(worldX, worldY, screen);
    if (port) return port;
    // The rack rises above the floor. A click on its visible mesh projects to
    // a different ground coordinate in an isometric camera, so resolve that
    // mesh hit before using the plan-view proximity fallback. Any utility tool
    // can claim the resulting access point; UniversalUtilityBusSystem assigns
    // that utility's fixed physical lane when the line commits.
    const rayHit = screen && this.renderer?.raycastUtilityLine?.(screen.x, screen.y);
    const hitBus = rayHit?.busId
      ? this.nearestBusAtWorld(
          rayHit.worldPos || this._isoFloatToWorld(worldX, worldY),
          Infinity,
          rayHit.busId,
        )
      : null;
    const bus = hitBus || this.nearestBus(worldX, worldY, BUS_SNAP_RADIUS_TILES);
    if (bus) return {
      open: true, busTap: true, busId: bus.busId, worldPos: bus.worldPos,
    };
    const descriptor = UTILITY_TYPES[this._utilityType];
    const requestedWaterCircuit = this._waterCircuitForAnchors(this._drawStart);
    const ordinaryTapAllowed = descriptor?.allowsTap !== false;
    // Bulky fabricated services can opt into a slightly wider pickup halo.
    // This changes only cursor assistance: the committed contact is still
    // projected onto the quarter-tile topology grid and validated normally.
    const tapSnapRadius = descriptor?.tapSnapRadiusTiles ?? TAP_SNAP_RADIUS_TILES;
    // Stacked runs project to different screen positions. If the cursor
    // actually hit a mesh, re-project onto THAT line's elevation and restrict
    // the subtile snap to its id; otherwise a plan-view tie would always grab
    // whichever lane happened to win insertion-order/highest-lane fallback.
    let tap = null;
    if (rayHit?.lineId && rayHit.utilityType === this._utilityType) {
      const lines = this.game.state.utilityLines;
      const hitLine = typeof lines?.get === 'function'
        ? lines.get(rayHit.lineId)
        : (lines || []).find(line => line?.id === rayHit.lineId);
      if (hitLine) {
        let lineWorld = { x: worldX, y: worldY };
        if (this.renderer?.screenToWorldAtHeight) {
          lineWorld = this.renderer.screenToWorldAtHeight(
            screen.x,
            screen.y,
            utilityLineHeight(hitLine.utilityType, hitLine.routeHeightMeters),
          );
        }
        tap = this.nearestLine(
          lineWorld.x, lineWorld.y, tapSnapRadius, rayHit.lineId,
          requestedWaterCircuit);
      }
    }
    tap = tap || this.nearestLine(
      worldX, worldY, tapSnapRadius, null, requestedWaterCircuit);
    if (!tap) return null;
    // Power and HV runs cannot be casually tee'd. A committed continuous
    // carrier is the explicit distribution fitting that makes that branch
    // legal, so it remains tappable even for those electrical utilities.
    if (!ordinaryTapAllowed && !tap.manifold) return null;
    return {
      open: true,
      tap: true,
      lineId: tap.lineId,
      worldPos: tap.worldPos,
      routeHeightMeters: tap.routeHeightMeters,
      waterCircuit: tap.waterCircuit,
    };
  }

  /** Nearest access point on any utility-neutral rack. */
  nearestBus(worldX, worldY, maxTiles = 0.4) {
    return this.nearestBusAtWorld(this._isoFloatToWorld(worldX, worldY), maxTiles);
  }

  nearestBusAtWorld(cursor, maxTiles = 0.65, onlyBusId = null) {
    let best = null;
    let bestDist = maxTiles * 2;
    for (const bus of this.game.state.utilityBuses || []) {
      if (onlyBusId && bus.id !== onlyBusId) continue;
      const accessPoints = (bus.taps || []).length > 0
        ? bus.taps.map(tap => ({
            col: (tap.point?.col || 0) + (tap.point?.subCol || 0) / 4,
            row: (tap.point?.row || 0) + (tap.point?.subRow || 0) / 4,
          }))
        : expandPath(bus.path || []);
      for (const point of accessPoints) {
        const dx = point.col * 2 - cursor.x;
        const dz = point.row * 2 - cursor.z;
        const dist = Math.hypot(dx, dz);
        if (dist < bestDist) {
          bestDist = dist;
          best = {
            busId: bus.id,
            worldPos: { x: point.col * 2, z: point.row * 2 },
            dist,
          };
        }
      }
    }
    return best;
  }

  /**
   * The nearest committed line of the armed utility to an iso-pixel cursor.
   *
   * Two callers, one notion of "on that line": right-click deletion (a power
   * cable is a 2 cm cylinder, so a mesh raycast alone misses often enough to
   * feel broken) and tapping a trunk to branch off it.
   *
   * Distance is measured against the rounded visible route for flexible runs,
   * and against the expanded grid path for rigid ones. Loose cables project
   * continuously onto that visible route; an explicit named tap carries their
   * topology. Cooling instead uses its exact rounded samples because that same
   * visible hose route is its physical network topology.
   *
   * @param {string|null} [onlyLineId] restrict a mesh-confirmed snap to one run
   * @returns {{lineId, worldPos: {x, z}, routeHeightMeters, dist}|null}
   *          dist in world metres
   */
  nearestLine(
    worldX, worldY, maxTiles = 0.5, onlyLineId = null, waterCircuit = null,
  ) {
    const lines = this.game.state.utilityLines;
    if (!lines || !this._utilityType) return null;
    const cursor = this._isoFloatToWorld(worldX, worldY);
    let best = null;
    let bestDist = maxTiles * 2;   // tiles → world metres
    const iter = typeof lines.values === 'function' ? lines.values() : lines;
    for (const line of iter) {
      if (!line || line.utilityType !== this._utilityType) continue;
      if (onlyLineId && line.id !== onlyLineId) continue;
      const lineCircuit = waterCircuit ? this._waterCircuitForLine(line) : null;
      if (waterCircuit && lineCircuit && lineCircuit !== waterCircuit) continue;
      const flexibleVisual = isSoftCable(line.utilityType) && Array.isArray(line.cablePath);
      const visual = flexibleVisual
        ? roundedCableTilePath(line.cablePath, line.utilityType)
        : expandPath(line.path || []);
      const candidates = this._lineSnapCandidates(
        visual, cursor, { quantize: !flexibleVisual },
      );
      for (const pt of candidates) {
        const dx = pt.col * 2 - cursor.x;
        const dz = pt.row * 2 - cursor.z;
        const d = Math.hypot(dx, dz);
        const routeHeightMeters = utilityLineHeight(
          line.utilityType, line.routeHeightMeters);
        if (d < bestDist - 1e-9
            || (Math.abs(d - bestDist) <= 1e-9
              && routeHeightMeters > (best?.routeHeightMeters ?? -Infinity))) {
          bestDist = d;
          best = {
            lineId: line.id,
            worldPos: { x: pt.col * 2, z: pt.row * 2 },
            routeHeightMeters,
            waterCircuit: this._waterCircuitForLine(line),
            manifold: !!line.manifold,
            dist: d,
          };
        }
      }
    }
    return best;
  }

  /**
   * Candidate contact points along a routed line. `expandPath` gives stable
   * quarter-tile topology points, but checking only those points makes the
   * magnetic target pulse as the cursor travels along a long segment. Project
   * onto every segment so the whole visible run is one continuous target.
   * Grid routes quantise that result back onto the topology grid; loose cable
   * routes retain the exact projected visual contact carried by a named tap.
   *
   * Cooling-water hoses intentionally keep their rounded sampled path: their
   * visible freeform trace is also their topology path, and projecting a new
   * point between those samples could create a visually near-but-not-touching
   * explicit join.
   */
  _lineSnapCandidates(path, cursorWorld, { quantize = true } = {}) {
    if (!Array.isArray(path) || path.length === 0) return [];
    const cursor = { col: cursorWorld.x / 2, row: cursorWorld.z / 2 };
    const candidates = path.map(point => ({ col: point.col, row: point.row }));
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      const dc = b.col - a.col;
      const dr = b.row - a.row;
      const lengthSq = dc * dc + dr * dr;
      if (lengthSq <= 1e-18) continue;
      const t = Math.max(0, Math.min(1,
        ((cursor.col - a.col) * dc + (cursor.row - a.row) * dr) / lengthSq));
      const projected = { col: a.col + dc * t, row: a.row + dr * t };
      candidates.push(quantize
        ? { col: snapQ(projected.col), row: snapQ(projected.row) }
        : projected);
    }
    return candidates;
  }

  /**
   * The port the cursor is pointing at, or null.
   *
   * Hit-tested in SCREEN space against each port's 3D anchor, not on the
   * ground plane. The renderer draws every port fitting, dot and cable end at
   * `portAnchor3D` — on the side of the machine, typically a metre up — while
   * `portWorldPosition` is the sim's answer, flat on the tile footprint. For
   * on-pipe hardware those are metres apart (measured: 3.7 m on a
   * cwCryomodule, 4.9 m on a srfLinacSector), because the footprint is the
   * reserved beam corridor and is far wider than the machine in it. Testing on
   * the ground meant you had to aim at a port's shadow rather than the port,
   * which is what made connectors feel detached from the hardware.
   *
   * Projecting handles perspective, zoom and view rotation for free: the pixel
   * radius is what the player's hand actually experiences, and it stays
   * constant as the camera moves, which a world-space radius does not.
   *
   * `screen` is absent for callers with no mouse event (tests, synthetic
   * gestures); those fall back to the original ground-plane test, which is
   * still correct for floor-standing equipment and is what the headless suites
   * assert against.
   */
  _snapToNearestPort(worldX, worldY, screen, utilityType = this._utilityType) {
    const state = this.game.state;
    const lines = state.utilityLines;
    const cursorWorld = this._isoFloatToWorld(worldX, worldY);
    const canProject = !!(screen && this.renderer
      && typeof this.renderer.worldToScreen === 'function');

    let best = null;
    const activeWaterCircuit = this._drawing
      ? this._waterCircuitForAnchors(this._drawStart)
      : this._selectedWaterCircuit;
    // Two different metrics, so two different budgets: pixels when projecting,
    // world metres on the fallback path.
    let bestDist = canProject ? PORT_SNAP_RADIUS_PX : PORT_SNAP_RADIUS_WORLD;

    // Endpoints, not state.placeables: components carried on beam pipes
    // (cavities, cryomodules, BPMs) declare utility ports too, and hit-testing
    // placeables alone made those ports impossible to grab.
    for (const placeable of listUtilityEndpoints(state)) {
      const def = COMPONENTS[placeable.type];
      if (!def || !def.ports) continue;
      const types = utilityType
        ? [utilityType]
        : [...new Set(Object.values(def.ports).map(spec => spec?.utility).filter(Boolean))];
      for (const type of types) {
        const availableNames = availablePorts(placeable, def, type, lines);
        for (const name of availableNames) {
          const candidateCircuit = portWaterCircuit(def.ports[name]);
          if (activeWaterCircuit && candidateCircuit
              && candidateCircuit !== activeWaterCircuit) continue;
        // The endpoint REFERENCE is what the solver reads; the path geometry
        // should start where the connector is actually drawn. On-pipe hardware
        // can reserve a footprint several metres wider than its model, so
        // routing from portWorldPosition made a large U-turn to the footprint
        // edge and then folded back into the visible fitting. Headless callers
        // have no measured anchor and retain the stable sim position.
        const pos = portWorldPosition(placeable, def, name);
        if (!pos) continue;

        let d;
        let routePos = pos;
        let resolvedAnchor = null;
        if (canProject) {
          const anchor = portAnchor3D(placeable, def, name);
          if (!anchor) continue;
          const px = this.renderer.worldToScreen(anchor.x, anchor.y, anchor.z);
          if (!px) continue;
          d = Math.hypot(px.x - screen.x, px.y - screen.y);
          routePos = { x: anchor.x, z: anchor.z };
          resolvedAnchor = anchor;
        } else {
          d = Math.hypot(pos.x - cursorWorld.x, pos.z - cursorWorld.z);
        }

          if (d < bestDist) {
            bestDist = d;
            best = {
              placeableId: placeable.id,
              portName: name,
              worldPos: routePos,
              utilityType: type,
              waterCircuit: candidateCircuit,
              anchor: resolvedAnchor,
            };
          }
        }
      }
    }
    return best;
  }

  // 3D-world {x, z} from a logical or measured port position → tile coord.
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
