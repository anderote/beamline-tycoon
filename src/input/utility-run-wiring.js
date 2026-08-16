// src/input/utility-run-wiring.js
//
// Run-wiring planner: one drag along a beam pipe, every compatible sink it
// passes gets its own line.
//
// On-pipe components are wired individually (cavities, quads, BPMs and
// cryomodules each declare their own pwr_in / rf_in / cryo_in), so a FODO cell
// is a dozen identical endpoint-to-endpoint drags. This module turns that into
// one gesture: given the source port the drag is anchored on and the Manhattan
// path the cursor has swept, it returns the exact set of lines that will be
// committed — pre-validated with the same validateDrawLine the single-line
// path uses, so the plan and the commit cannot disagree.
//
// Why fan-out from one source port works: line-drawing.js already exempts
// lines that share a source endpoint from the same-type overlap check (the
// `ignoreSharedSource` branch), because one transformer's pwr_out is meant to
// feed several sinks and capacity is divided among them. Run-wiring is that
// case, N times, in one action.
//
// Everything here is pure — no game mutation, no undo, no charging. The
// controller owns the commit (a single Game.commitGesture).

import { COMPONENTS } from '../data/components.js';
import { UTILITY_TYPES } from '../utility/registry.js';
import {
  getPortSpec,
  portApproachVec,
  portWorldPosition,
  availablePorts,
} from '../utility/ports.js';
import {
  buildPortRoutedPath,
  findObstacleAwareRoute,
  pathLengthSubUnits,
} from '../utility/line-geometry.js';
import { validateDrawLine } from '../utility/line-drawing.js';
import { buildRigidRouteObstacles } from '../utility/route-obstacles.js';
import { listUtilityEndpoints, findUtilityEndpoint } from '../utility/utility-endpoints.js';

// Half-width of the run corridor, in tiles. A sink port counts as "passed" if
// it lies within this distance of the dragged path. Ports sit on the edge of a
// placement's footprint, i.e. up to half a tile off the pipe centreline, so a
// full tile catches both sides of the pipe without reaching the next one over.
export const RUN_CORRIDOR_TILES = 1.0;

const EPS = 1e-6;

function snapQ(v) { return Math.round(v * 4) / 4; }

// Port world {x, z} → tile coords, snapped to the sub-tile grid the rest of
// the utility-line path system stores. 1 tile = 2 world metres.
function portTile(pos) {
  return { col: snapQ(pos.x / 2), row: snapQ(pos.z / 2) };
}

/**
 * The device's free source ports of this utility, anchored port first.
 *
 * Order matters twice: the anchor is what the player actually clicked, so it
 * must be used before its neighbours, and the rest follow port-table order so
 * a plan is reproducible.
 */
function orderedFreeOutlets(endpoint, def, utilityType, lines, anchorName) {
  const free = availablePorts(endpoint, def, utilityType, lines)
    .filter(name => {
      const spec = getPortSpec(def, name);
      return spec && spec.role === 'source';
    });
  const rest = free.filter(n => n !== anchorName);
  return free.includes(anchorName) ? [anchorName, ...rest] : rest;
}

// --- corridor geometry -----------------------------------------------------

function nearestOnSegment(p, a, b) {
  const vc = b.col - a.col;
  const vr = b.row - a.row;
  const len2 = vc * vc + vr * vr;
  const segLen = Math.sqrt(len2);
  let t = len2 < EPS ? 0 : ((p.col - a.col) * vc + (p.row - a.row) * vr) / len2;
  t = Math.max(0, Math.min(1, t));
  const dc = p.col - (a.col + vc * t);
  const dr = p.row - (a.row + vr * t);
  return { dist: Math.hypot(dc, dr), along: t * segLen, segLen };
}

/**
 * Distance from `p` to the polyline, plus how far along the polyline the
 * closest point sits. `along` orders the stubs so the plan (and the preview)
 * reads in the direction the player dragged.
 */
export function nearestOnPath(p, path) {
  let best = { dist: Infinity, along: 0 };
  let acc = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const r = nearestOnSegment(p, path[i], path[i + 1]);
    if (r.dist < best.dist - EPS) best = { dist: r.dist, along: acc + r.along };
    acc += r.segLen;
  }
  return best;
}

// --- stub routing ----------------------------------------------------------

/**
 * A Manhattan path from a source fitting to a sink fitting. Port vectors make
 * the lead-outs tidy visually; validator rules do not require their direction.
 */
export function buildRunStubPath(srcTile, srcVec, sinkTile, sinkVec, preferVerticalFirst, opts = {}) {
  return buildPortRoutedPath(srcTile, srcVec, sinkTile, sinkVec, {
    preferVerticalFirst,
    allowZeroLength: !!opts.allowZeroLength,
    portClearance: opts.portClearance !== false,
    portTailTiles: opts.portTailTiles,
    minStraightTiles: opts.minStraightTiles,
  });
}

// --- planning --------------------------------------------------------------

/**
 * Every line a run-wiring drag would commit.
 *
 * @param {object} state          game state (placeables, beamPipes, utilityLines)
 * @param {string} opts.utilityType
 * @param {{placeableId, portName}} opts.source  the drag anchor; must be a
 *        source-role port of `utilityType` or the plan is empty
 * @param {Array<{col,row}>} opts.runPath  the dragged Manhattan path
 * @param {number} [opts.corridor]         half-width in tiles
 * @param {boolean} [opts.preferVerticalFirst]
 * @param {Function} [opts.portPosition]   optional (endpoint, def, portName)
 *        position resolver; interactive routing supplies measured connector
 *        X/Z/Y while headless/scenario callers retain portWorldPosition
 * @returns {{stubs: Array, totalSubL: number, skipped: number}}
 *          `stubs` are ready-to-commit addLine arguments in drag order;
 *          `skipped` counts candidates in the corridor that no route reached.
 */
export function planUtilityRun(state, {
  utilityType,
  source,
  runPath,
  corridor = RUN_CORRIDOR_TILES,
  preferVerticalFirst = false,
  portPosition = portWorldPosition,
} = {}) {
  const empty = { stubs: [], totalSubL: 0, skipped: 0 };
  if (!state || !utilityType || !source || !source.placeableId || !source.portName) return empty;
  if (!Array.isArray(runPath) || runPath.length < 2) return empty;
  const resolvePortPosition = typeof portPosition === 'function'
    ? portPosition
    : portWorldPosition;

  const srcEndpoint = findUtilityEndpoint(state, source.placeableId);
  if (!srcEndpoint) return empty;
  const srcDef = COMPONENTS[srcEndpoint.type];
  const srcSpec = getPortSpec(srcDef, source.portName);
  // The drag has to be anchored on a source port: a sink is claimed by the
  // first line and every later stub would reject with port_taken.
  if (!srcSpec || srcSpec.utility !== utilityType || srcSpec.role !== 'source') return empty;

  // How many stubs this gesture can start, and from where.
  //
  // A fanning utility (a manifold outlet feeding several branches) serves every
  // stub from the one anchored port. A non-fanning one — power, HV, RF, fibre —
  // takes one cable per socket, so the gesture walks the device's FREE OUTLETS
  // in order and stops when they run out. That is the whole point of a
  // distribution panel having four sockets instead of one: shift-dragging along
  // a row of magnets wires as many as the panel can take, and says so.
  const fanOut = (UTILITY_TYPES[utilityType] || {}).fansOut !== false;
  const outletNames = fanOut
    ? [source.portName]
    : orderedFreeOutlets(srcEndpoint, srcDef, utilityType, state.utilityLines, source.portName);
  const outlets = [];
  for (const name of outletNames) {
    const vec = portApproachVec(srcEndpoint, srcDef, name);
    const pos = resolvePortPosition(srcEndpoint, srcDef, name);
    if (!pos) continue;
    outlets.push({
      portName: name,
      vec,
      tile: portTile(pos),
      routeHeightMeters: Number.isFinite(pos.y) ? pos.y : null,
    });
  }
  if (outlets.length === 0) return empty;

  const lines = state.utilityLines;
  const candidates = [];
  for (const endpoint of listUtilityEndpoints(state)) {
    if (!endpoint || endpoint.id === source.placeableId) continue;
    const def = COMPONENTS[endpoint.type];
    if (!def || !def.ports) continue;
    // availablePorts already drops ports claimed by an existing line of this
    // utility — "compatible" means declares a sink and is not yet wired.
    for (const portName of availablePorts(endpoint, def, utilityType, lines)) {
      const spec = getPortSpec(def, portName);
      if (!spec || spec.role !== 'sink') continue;
      const pos = resolvePortPosition(endpoint, def, portName);
      const vec = portApproachVec(endpoint, def, portName);
      if (!pos) continue;
      const tile = portTile(pos);
      const near = nearestOnPath(tile, runPath);
      if (near.dist > corridor + EPS) continue;
      candidates.push({ placeableId: endpoint.id, portName, tile, vec, along: near.along });
    }
  }

  candidates.sort((a, b) => (a.along - b.along)
    || (a.placeableId < b.placeableId ? -1 : a.placeableId > b.placeableId ? 1 : 0)
    || (a.portName < b.portName ? -1 : a.portName > b.portName ? 1 : 0));

  const stubs = [];
  let totalSubL = 0;
  let skipped = 0;
  let outletIdx = 0;
  // Each stub is validated against the world INCLUDING the stubs already
  // planned, not just the committed ones. With one shared source port that was
  // unnecessary — the overlap check exempts lines that share a source — but a
  // non-fanning utility gives every stub its own outlet, so two stubs from the
  // same panel can collide with each other. Validating against a clean world
  // made the planner promise four lines and the commit land three, which is
  // exactly the plan/commit disagreement this module exists to prevent.
  const planned = [];
  const probeState = { ...state, utilityLines: planned };
  const existingLines = state.utilityLines;
  const iterExisting = existingLines && typeof existingLines.values === 'function'
    ? Array.from(existingLines.values())
    : (existingLines || []);
  planned.push(...iterExisting);

  for (const c of candidates) {
    // Out of sockets: the rest of the swept sinks are reported as unreachable
    // rather than silently dropped, so the tooltip's "N unreachable" is the
    // player's cue that this panel is full.
    if (outletIdx >= outlets.length) { skipped++; continue; }
    const outlet = outlets[outletIdx];
    const start = { placeableId: source.placeableId, portName: outlet.portName };
    const end = { placeableId: c.placeableId, portName: c.portName };
    let chosen = null;
    let chosenRouteHeight = null;
    // Both bend orders are legal routes; take whichever the real validator
    // accepts, so an incompatible sink is skipped rather than failing the run.
    for (const vf of [preferVerticalFirst, !preferVerticalFirst]) {
      const directPowerJumper = utilityType === 'powerCable'
        && Math.abs(outlet.tile.col - c.tile.col) + Math.abs(outlet.tile.row - c.tile.row) <= 0.5;
      const path = buildRunStubPath(
        outlet.tile, directPowerJumper ? null : outlet.vec,
        c.tile, directPowerJumper ? null : c.vec,
        vf, {
        allowZeroLength: utilityType === 'powerCable',
        portClearance: UTILITY_TYPES[utilityType]?.portClearance !== false,
        portTailTiles: UTILITY_TYPES[utilityType]?.portTailTiles,
        minStraightTiles: UTILITY_TYPES[utilityType]?.minStraightTiles,
      });
      if (!path) continue;
      const checked = validateDrawLine(probeState, {
        utilityType,
        start,
        end,
        path,
        preferredRouteHeightMeters: outlet.routeHeightMeters,
      });
      if (checked.ok) {
        chosen = path;
        chosenRouteHeight = checked.line.routeHeightMeters ?? null;
        break;
      }
    }
    const descriptor = UTILITY_TYPES[utilityType] || {};
    if (!chosen && descriptor.routingProfile === 'rigid') {
      const obstacles = buildRigidRouteObstacles(probeState, utilityType, { startRef: start, endRef: end });
      const path = findObstacleAwareRoute(outlet.tile, outlet.vec, c.tile, c.vec, {
        preferVerticalFirst,
        portClearance: descriptor.portClearance !== false,
        portTailTiles: descriptor.portTailTiles,
        minStraightTiles: descriptor.minStraightTiles,
        bendPenalty: descriptor.bendPenalty,
        blocked: obstacles.isBlocked,
      });
      if (path) {
        const checked = validateDrawLine(probeState, {
          utilityType,
          start,
          end,
          path,
          preferredRouteHeightMeters: outlet.routeHeightMeters,
        });
        if (checked.ok) {
          chosen = path;
          chosenRouteHeight = checked.line.routeHeightMeters ?? null;
        }
      }
    }
    if (!chosen) { skipped++; continue; }
    const subL = pathLengthSubUnits(chosen);
    stubs.push({
      start,
      end,
      path: chosen,
      subL,
      ...(Number.isFinite(chosenRouteHeight)
        ? { routeHeightMeters: chosenRouteHeight }
        : {}),
    });
    planned.push({
      id: `__plan_${stubs.length}`,
      utilityType,
      start,
      end,
      path: chosen,
      ...(Number.isFinite(chosenRouteHeight)
        ? { routeHeightMeters: chosenRouteHeight }
        : {}),
    });
    totalSubL += subL;
    // A fanning utility keeps serving every stub from the one port; a
    // non-fanning one consumes a socket per committed stub.
    if (!fanOut) outletIdx++;
  }

  return { stubs, totalSubL, skipped };
}

/**
 * One continuous polyline covering every stub, for the draw preview. The
 * renderer takes a single path, so each stub is walked out and back to the
 * shared source (the last one only out) — every drawn segment lies on a real
 * stub, nothing spurious is drawn between them.
 */
export function runPreviewPath(stubs) {
  if (!Array.isArray(stubs) || stubs.length === 0) return [];
  const out = [];
  stubs.forEach((stub, i) => {
    const fwd = stub.path;
    if (out.length === 0) out.push(...fwd.map(p => ({ col: p.col, row: p.row })));
    else out.push(...fwd.slice(1).map(p => ({ col: p.col, row: p.row })));
    if (i < stubs.length - 1) {
      const back = fwd.slice(0, -1).reverse();
      out.push(...back.map(p => ({ col: p.col, row: p.row })));
      // Stubs no longer all start from the same port: a non-fanning utility
      // gives each one its own outlet, so the hop from this stub's origin to
      // the next one's is a real move across the device's faceplate. Walk it
      // as a corner rather than a straight line — the renderer draws whatever
      // it is handed, and a diagonal is geometry no stub has.
      const from = out[out.length - 1];
      const to = stubs[i + 1].path[0];
      if (Math.abs(from.col - to.col) > 1e-9 && Math.abs(from.row - to.row) > 1e-9) {
        out.push({ col: to.col, row: from.row });
      }
      // Land ON the next stub's origin: the next iteration appends from its
      // second point, so without this the walk jumps straight to the lead-out.
      out.push({ col: to.col, row: to.row });
    }
  });
  return out;
}

/**
 * What a committed run costs. Utility lines price themselves off length via
 * the descriptor's `costPerSubUnit`; a descriptor that declares none is free
 * and this returns null (commitGesture then charges nothing).
 */
export function runWiringCost(utilityType, subL) {
  const per = UTILITY_TYPES[utilityType] && UTILITY_TYPES[utilityType].costPerSubUnit;
  if (!per || !(subL > 0)) return null;
  return { funding: Math.round(per * subL) };
}

export default planUtilityRun;
