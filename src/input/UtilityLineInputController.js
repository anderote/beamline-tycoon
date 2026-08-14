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
import { availablePorts, portApproachVec, portWorldPosition } from '../utility/ports.js';
import { portAnchor3D } from '../utility/port-anchors.js';
import { buildPortRoutedPaths, pathLengthSubUnits, expandPath } from '../utility/line-geometry.js';
import { validateDrawLine } from '../utility/line-drawing.js';
import { reasonMessage } from '../utility/UtilityLineSystem.js';
import { UTILITY_TYPES } from '../utility/registry.js';
import { listUtilityEndpoints, findUtilityEndpoint } from '../utility/utility-endpoints.js';
import { planUtilityRun, runPreviewPath, runWiringCost } from './utility-run-wiring.js';
import { isoToGridFloat } from '../renderer/grid.js';

// Snap tolerance between cursor and a port's world position, in world meters.
// 1.0 = half a tile — roomy so the player can grab a port without needing
// pixel-perfect aim. Tightened automatically (0.5) near ports on the same
// placeable since those are packed tighter.
const PORT_SNAP_RADIUS_WORLD = 1.0;

// Grab radius around a port's PROJECTED anchor, in viewport pixels. Sized to
// the fitting the renderer draws there plus a forgiving margin. Thirty pixels
// gives open ports a genuinely magnetic target during both pickup and drop;
// crowded connectors remain separable because _snapToNearestPort always picks
// the nearest candidate. Pixels, not metres, because this is a hand-eye budget
// — it must not shrink as the player zooms out.
const PORT_SNAP_RADIUS_PX = 30;

// How close the cursor has to be to an existing line of the same utility to
// grab it, in tiles. Tighter than the port radius: ports are the primary
// target and a trunk usually runs right past one, so a generous tap radius
// would steal clicks meant for the port at the end of it.
const TAP_SNAP_RADIUS_TILES = 0.4;

// Run-wiring corridor sampling. The corridor is the polyline the cursor
// actually traced, so it needs a floor on sample spacing (mouse jitter) and a
// ceiling on point count (an unbounded drag re-plans against it every move).
const RUN_TRACE_MIN_STEP = 0.5;      // tiles
const RUN_TRACE_MAX_POINTS = 256;

// How far down the router's ranking a drag will look for a route the board
// accepts. See _dragGeometry: each step costs a full validateDrawLine, which
// expands every same-type line on the board, and this runs per mousemove.
const MAX_ROUTE_CANDIDATES = 6;

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
    this._dragReject = null; // validator reason the current drag would fail on
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

  // Public: start-anchor while mid-draw ({placeableId, portName, worldPos}).
  // Renderer uses this to skip the start port's indicator while dragging.
  get drawStart() { return this._drawStart; }

  // Public: live Manhattan preview path while dragging (null otherwise).
  get preview() { return this._preview; }

  // Public: the port the cursor is snapped to (null if none).
  get hoverPort() { return this._hoverPort; }

  // Public: player-facing reason the drag as it stands would be REFUSED, or
  // null when it would commit. Read by the tool for the drag tooltip.
  get dragReject() {
    return this._dragReject ? reasonMessage(this._dragReject) : null;
  }

  // Public: the run-wiring plan the current drag would commit, or null when
  // the drag is an ordinary single line. The tool layer reads `stubs.length`
  // and `cost` for the drag tooltip.
  get runPlan() { return this._runPlan; }

  // Public: what the gesture as it stands would be charged, in funding — the
  // run plan's total, or the single line's own length. Both commits price
  // through _wiringCost, so the tooltip cannot quote a number the commit
  // does not take.
  get dragCost() {
    if (this._runPlan && this._runPlan.stubs.length > 0) {
      return (this._runPlan.cost && this._runPlan.cost.funding) || 0;
    }
    const c = this._wiringCost(pathLengthSubUnits(this._drawPath));
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
    this._preview = {
      utilityType: this._utilityType,
      path: [],
      color: UTILITY_TYPES[this._utilityType]?.color || '#ffffff',
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
      this.game.commitGesture({
        validate: () => !(startRef && endRef
          && startRef.placeableId === endRef.placeableId
          && startRef.portName === endRef.portName),
        cost: this._wiringCost(pathLengthSubUnits(path)) || undefined,
        mutate: () => this.game.utilityLineSystem.addLine({
          utilityType: this._utilityType,
          start: startRef,
          end: endRef,
          path,
          tapLineIds: geom.tapLineIds,
        }),
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
   * near one, start + end quantised to the 0.25 sub-tile grid, and the path
   * between them (null when the drag has not left the anchor).
   *
   * Routing is port-aware and validator-checked, exactly as a run-wiring stub
   * is: each port end gets a lead-out along its own outward normal, and the
   * route between them comes from buildPortRoutedPaths. A plain start→end
   * Manhattan L only satisfied the ports' approach constraints by luck, so most
   * drags — anything back toward a source, or between ports whose sides didn't
   * match the L's shape — died at commit with "doesn't align with port
   * direction".
   *
   * Two jobs are being done here and they belong to different owners. Is this
   * route a SENSIBLE shape — does it double back, how many corners does it turn
   * — is geometry, and the router ranks candidates on it. Is this route LEGAL —
   * does it lie on top of cable that is already down — needs the board, which
   * the router cannot see. So the router hands over its whole ranking and this
   * walks it, taking the best shape the validator accepts.
   *
   * That walk is why this cannot collapse to one call. It used to try the two
   * bend orders and keep whichever validated, and half of that was theatre: the
   * mandatory lead-outs make the first and last segment directions correct in
   * EVERY candidate, so the port-approach checks always passed for both and the
   * hairpinning order won whenever preferVerticalFirst pointed at it. But the
   * other half was real — overlap_same_type genuinely differs between shapes,
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
    // A tap end is an open end that is allowed to touch one specific line, at
    // exactly the subtile it lands on. Everything else about it is ordinary.
    const tapLineIds = {
      start: this._drawStart && this._drawStart.tap ? this._drawStart.lineId : null,
      end: endAnchor && endAnchor.tap ? endAnchor.lineId : null,
    };

    const candidates = buildPortRoutedPaths(
      startTile, this._anchorVec(this._drawStart),
      endTile, this._anchorVec(endAnchor),
      { preferVerticalFirst: this._preferVerticalFirst });

    let chosen = null;
    let reason = null;
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
      });
      if (res.ok) { chosen = path; break; }
      // The reason shown is the FIRST failure: it is the one that explains why
      // the route the player is looking at — the preview, which is candidate
      // zero — would be refused.
      if (reason === null) reason = res.reason;
    }
    // Why the gesture would be refused, for the drag tooltip. The commit path
    // logs this too, but the log has no on-screen surface — leaving "release
    // and nothing happens" as the only feedback the player ever got.
    this._dragReject = chosen ? null : reason;
    return {
      startTile, endTile, endAnchor, startRef, endRef, tapLineIds,
      path: chosen || fallback,
    };
  }

  /** {placeableId, portName} for a port-anchored draw end, null when open. */
  _anchorRef(anchor) {
    if (!anchor || anchor.open || !anchor.placeableId) return null;
    return { placeableId: anchor.placeableId, portName: anchor.portName };
  }

  /** Outward normal of a draw end's port, null when the end is open. */
  _anchorVec(anchor) {
    const ref = this._anchorRef(anchor);
    if (!ref) return null;
    const endpoint = findUtilityEndpoint(this.game.state, ref.placeableId);
    const def = endpoint ? COMPONENTS[endpoint.type] : null;
    if (!def) return null;
    return portApproachVec(endpoint, def, ref.portName);
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
          const actual = this._wiringCost(subL) || {};
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
    const tap = this.nearestLine(worldX, worldY, TAP_SNAP_RADIUS_TILES);
    if (!tap) return null;
    return { open: true, tap: true, lineId: tap.lineId, worldPos: tap.worldPos };
  }

  /**
   * The nearest committed line of the armed utility to an iso-pixel cursor.
   *
   * Two callers, one notion of "on that line": right-click deletion (a power
   * cable is a 2 cm cylinder, so a mesh raycast alone misses often enough to
   * feel broken) and tapping a trunk to branch off it.
   *
   * Distance is measured against the expanded path — the same 0.25-tile
   * sampling network discovery uses to decide two lines touch — so what the
   * player can grab and what the sim will merge are the same points.
   *
   * @returns {{lineId, worldPos: {x, z}, dist}|null} dist in world metres
   */
  nearestLine(worldX, worldY, maxTiles = 0.5) {
    const lines = this.game.state.utilityLines;
    if (!lines || !this._utilityType) return null;
    const cursor = this._isoFloatToWorld(worldX, worldY);
    let best = null;
    let bestDist = maxTiles * 2;   // tiles → world metres
    const iter = typeof lines.values === 'function' ? lines.values() : lines;
    for (const line of iter) {
      if (!line || line.utilityType !== this._utilityType) continue;
      for (const pt of expandPath(line.path || [])) {
        const dx = pt.col * 2 - cursor.x;
        const dz = pt.row * 2 - cursor.z;
        const d = Math.hypot(dx, dz);
        if (d < bestDist) {
          bestDist = d;
          best = { lineId: line.id, worldPos: { x: pt.col * 2, z: pt.row * 2 }, dist: d };
        }
      }
    }
    return best;
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
  _snapToNearestPort(worldX, worldY, screen) {
    const state = this.game.state;
    const lines = state.utilityLines;
    const cursorWorld = this._isoFloatToWorld(worldX, worldY);
    const canProject = !!(screen && this.renderer
      && typeof this.renderer.worldToScreen === 'function');

    let best = null;
    // Two different metrics, so two different budgets: pixels when projecting,
    // world metres on the fallback path.
    let bestDist = canProject ? PORT_SNAP_RADIUS_PX : PORT_SNAP_RADIUS_WORLD;

    // Endpoints, not state.placeables: components carried on beam pipes
    // (cavities, cryomodules, BPMs) declare utility ports too, and hit-testing
    // placeables alone made those ports impossible to grab.
    for (const placeable of listUtilityEndpoints(state)) {
      const def = COMPONENTS[placeable.type];
      if (!def || !def.ports) continue;
      const availableNames = availablePorts(placeable, def, this._utilityType, lines);
      for (const name of availableNames) {
        // The sim's point stays the committed endpoint either way — only the
        // hit test moves. A line still starts and ends where the solver says.
        const pos = portWorldPosition(placeable, def, name);
        if (!pos) continue;

        let d;
        if (canProject) {
          const anchor = portAnchor3D(placeable, def, name);
          if (!anchor) continue;
          const px = this.renderer.worldToScreen(anchor.x, anchor.y, anchor.z);
          if (!px) continue;
          d = Math.hypot(px.x - screen.x, px.y - screen.y);
        } else {
          d = Math.hypot(pos.x - cursorWorld.x, pos.z - cursorWorld.z);
        }

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
