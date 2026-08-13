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
import { buildPortRoutedPath, pathLengthSubUnits } from '../utility/line-geometry.js';
import { validateDrawLine } from '../utility/line-drawing.js';
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
 * A path from a source port to a sink port that satisfies both ports' approach
 * constraints: it leaves the source along the source side's outward normal and
 * arrives at the sink against the sink side's outward normal (what
 * portMatchesApproach demands of the first and last segment). Between the two
 * lead-outs it is an ordinary Manhattan path.
 */
export function buildRunStubPath(srcTile, srcVec, sinkTile, sinkVec, preferVerticalFirst) {
  return buildPortRoutedPath(srcTile, srcVec, sinkTile, sinkVec, { preferVerticalFirst });
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
} = {}) {
  const empty = { stubs: [], totalSubL: 0, skipped: 0 };
  if (!state || !utilityType || !source || !source.placeableId || !source.portName) return empty;
  if (!Array.isArray(runPath) || runPath.length < 2) return empty;

  const srcEndpoint = findUtilityEndpoint(state, source.placeableId);
  if (!srcEndpoint) return empty;
  const srcDef = COMPONENTS[srcEndpoint.type];
  const srcSpec = getPortSpec(srcDef, source.portName);
  // Only a source port can fan out: a sink port is claimed by the first line
  // and every later stub would reject with port_taken.
  if (!srcSpec || srcSpec.utility !== utilityType || srcSpec.role !== 'source') return empty;
  const srcVec = portApproachVec(srcEndpoint, srcDef, source.portName);
  const srcPos = portWorldPosition(srcEndpoint, srcDef, source.portName);
  if (!srcVec || !srcPos) return empty;
  const srcTile = portTile(srcPos);

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
      const pos = portWorldPosition(endpoint, def, portName);
      const vec = portApproachVec(endpoint, def, portName);
      if (!pos || !vec) continue;
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
  for (const c of candidates) {
    const start = { placeableId: source.placeableId, portName: source.portName };
    const end = { placeableId: c.placeableId, portName: c.portName };
    let chosen = null;
    // Both bend orders are legal routes; take whichever the real validator
    // accepts, so an incompatible sink is skipped rather than failing the run.
    for (const vf of [preferVerticalFirst, !preferVerticalFirst]) {
      const path = buildRunStubPath(srcTile, srcVec, c.tile, c.vec, vf);
      if (!path) continue;
      if (validateDrawLine(state, { utilityType, start, end, path }).ok) {
        chosen = path;
        break;
      }
    }
    if (!chosen) { skipped++; continue; }
    const subL = pathLengthSubUnits(chosen);
    stubs.push({ start, end, path: chosen, subL });
    totalSubL += subL;
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
