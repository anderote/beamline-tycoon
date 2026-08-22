// src/utility/line-drawing.js
//
// Pure validator for drawing a utility line between two ports. Mirrors the
// shape of src/beamline/pipe-drawing.js but with these differences:
//   - Compatibility paths contain 90° Manhattan bends (no diagonals).
//   - Soft cords and hoses may also carry their unsnapped physical cablePath.
//   - Equipment blocks only when measured 3D model geometry intersects the
//     utility body at its actual route height.
//   - Endpoints reference placeables via `placeableId` (not `junctionId`).
//   - Port normals guide route ranking but never make an otherwise valid path illegal.
//
// Rejection reasons:
//   invalid_path, not_manhattan, overlap_same_type,
//   invalid_start, invalid_end, port_type_mismatch, port_taken,
//   off_subtile_grid, blocked_by_equipment.

import { COMPONENTS } from '../data/components.js';
import { UTILITY_TYPES, utilityLineHeight } from './registry.js';
import {
  getPortSpec,
  utilityPortConnectionLimit,
} from './ports.js';
import {
  pathLengthSubUnits,
  expandPath,
} from './line-geometry.js';
import { buildUtilityRouteObstacles } from './route-obstacles.js';
import {
  isUtilityRouteCoordinate,
  usesFlexibleSubtileRouting,
} from './routing-contract.js';
import {
  routeHeightForLine,
  routeHeightsConflict,
  usesFixedRouteHeight,
} from './route-elevation.js';
import { findUtilityEndpoint } from './utility-endpoints.js';
import {
  cablePathLengthSubUnits,
  isSoftCable,
  roundedCableTilePath,
  sanitizeCablePath,
  isOverheadHvSupport,
  softCableSkipsOverlap,
} from './soft-cable.js';
import { pathCrossesWall } from './wall-crossings.js';
import {
  isWaterUtility,
  lineWaterCircuit,
  portWaterCircuit,
  WATER_CIRCUIT_COLD,
  WATER_CIRCUIT_HOT,
} from './water-circuits.js';

const EPS = 1e-6;
const PHYSICAL_COLLISION_SAMPLE_STEP = 0.125;

function reject(reason) { return { ok: false, reason }; }

/** Densify arbitrary physical traces so a long segment cannot skip a model. */
function samplePhysicalPath(path, maxStep = PHYSICAL_COLLISION_SAMPLE_STEP) {
  if (!Array.isArray(path) || path.length === 0) return [];
  const out = [{ col: path[0].col, row: path[0].row }];
  for (let i = 1; i < path.length; i++) {
    const start = path[i - 1];
    const end = path[i];
    const dc = end.col - start.col;
    const dr = end.row - start.row;
    const steps = Math.max(1, Math.ceil(Math.hypot(dc, dr) / maxStep));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      out.push({ col: start.col + dc * t, row: start.row + dr * t });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Path shape validators.
// ---------------------------------------------------------------------------

/**
 * Each adjacent pair must be axis-aligned (one of dCol, dRow is zero). Zero
 * length segments are tolerated here (buildManhattanPath never produces them;
 * tests must guard against invalid_path separately).
 */
function isManhattanPath(path) {
  for (let i = 0; i < path.length - 1; i++) {
    const dc = path[i + 1].col - path[i].col;
    const dr = path[i + 1].row - path[i].row;
    if (Math.abs(dc) > EPS && Math.abs(dr) > EPS) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Plan overlap and physical-clearance checks.
// ---------------------------------------------------------------------------

function pointsOverlap(a, b, clearanceTiles = 0.25, inclusive = false) {
  const limit = inclusive ? clearanceTiles + EPS : clearanceTiles - EPS;
  return Math.abs(a.col - b.col) < limit
      && Math.abs(a.row - b.row) < limit;
}

// ---------------------------------------------------------------------------
// What a shared subtile MEANS.
//
// It used to mean exactly one thing — "these two runs are the same network" —
// which forced this check to reject every shared subtile, so two power cables
// could not cross. In a hall with a few runs in it that makes whole regions
// unroutable, for the same reason and with the same message as genuinely
// laying cable down an existing trunk.
//
// Three readings, told apart by geometry:
//
//   endpoint of one run, interior of the other   a tee: the runs are JOINED.
//                                                Legal only for a utility that
//                                                declares allowsTap, and then
//                                                only via the tapLineIds
//                                                exemption.
//   interior of both, perpendicular              normally a crossing: one
//                                                passes over the other. For a
//                                                joinsOnContact service it is
//                                                instead a fabricated junction.
//   interior of both, collinear                  normally a duplicate run. A
//                                                joinsOnContact service reuses
//                                                that shared trunk geometry.
//
// discoverNetworks consumes the same descriptor switch, so validation and
// topology cannot disagree about whether contact joins two runs.
// ---------------------------------------------------------------------------

/** 'h' | 'v' | null for the segment a→b. */
function segmentAxis(a, b) {
  if (Math.abs(b.col - a.col) > EPS) return 'h';
  if (Math.abs(b.row - a.row) > EPS) return 'v';
  return null;
}

/**
 * The axes a polyline occupies at expanded index `i` — one for a point mid-run,
 * two at a corner. Two runs are perpendicular at a shared point iff their axis
 * sets are disjoint.
 */
export function axesAtIndex(expanded, i) {
  const out = new Set();
  if (i > 0) {
    const ax = segmentAxis(expanded[i - 1], expanded[i]);
    if (ax) out.add(ax);
  }
  if (i < expanded.length - 1) {
    const ax = segmentAxis(expanded[i], expanded[i + 1]);
    if (ax) out.add(ax);
  }
  return out;
}

function isPerpendicular(axesA, axesB) {
  if (axesA.size === 0 || axesB.size === 0) return false;
  for (const ax of axesA) if (axesB.has(ax)) return false;
  return true;
}

function pathOverlapReason(newPath, lines, utilityType, opts = {}) {
  const newExpanded = expandPath(newPath);
  const newDescriptor = UTILITY_TYPES[utilityType] || {};
  const newRouteHeight = opts.routeHeightMeters;
  const ignoreSharedSource = opts.ignoreSharedSource || null; // { start, end }
  // Tap: this end of the new line deliberately lands ON an existing line, to
  // branch off it. Exempt exactly ONE point — the terminal subtile at that end
  // — against exactly that line. A path that then runs ALONG the trunk still
  // overlaps at its second point and still rejects, which is what keeps the
  // overlap rule meaning something.
  const tapLineIds = opts.tapLineIds || null;
  const tapExempt = new Map();   // lineId -> Set of exempt indices in newExpanded
  if (tapLineIds && newExpanded.length > 0) {
    const add = (id, idx) => {
      if (!id) return;
      let set = tapExempt.get(id);
      if (!set) { set = new Set(); tapExempt.set(id, set); }
      set.add(idx);
    };
    add(tapLineIds.start, 0);
    add(tapLineIds.end, newExpanded.length - 1);
  }
  const iter = lines && typeof lines.values === 'function'
    ? lines.values()
    : (lines || []);
  for (const line of iter) {
    if (!line) continue;
    const sameType = line.utilityType === utilityType;
    const existingWaterCircuit = opts.resolveWaterCircuit?.(line)
      || lineWaterCircuit(line);
    if (sameType && isWaterUtility(utilityType)
        && opts.waterCircuit && existingWaterCircuit
        && opts.waterCircuit !== existingWaterCircuit) continue;
    const fixedHeightPair = usesFixedRouteHeight(utilityType)
      && usesFixedRouteHeight(line.utilityType);
    const physicalConflict = fixedHeightPair;
    if (!sameType && !physicalConflict) continue;
    // Fabricated vacuum, cryogenic, and RF services are deliberately easy to
    // extend: drawing through any installed run of the same service means
    // "join here", including a shared collinear trunk. Network discovery
    // unions every exact shared route coordinate for the same descriptor.
    // Different rigid services still pass through the ordinary height/body
    // clearance check below.
    if (sameType && newDescriptor.joinsOnContact === true) continue;
    if (fixedHeightPair && Number.isFinite(newRouteHeight)
        && !routeHeightsConflict(
          utilityType, newRouteHeight,
          line.utilityType, routeHeightForLine(line),
        )) continue;
    const existingDescriptor = UTILITY_TYPES[line.utilityType] || {};
    const clearanceTiles = physicalConflict
      ? Math.max(newDescriptor.routeClearanceTiles || 0.25,
        existingDescriptor.routeClearanceTiles || 0.25)
      : 0.25;
    // Branching: if new line shares a source endpoint with this existing line,
    // ignore overlap at that shared endpoint's subtiles (the start/end point).
    // This allows one hvTransformer pwr_out to fan out to multiple sinks via
    // capacity, while still blocking interior overlaps between unrelated lines.
    // Runs leaving the same supply DEVICE share a tray.
    //
    // The exemption used to be per-PORT, which was enough when one source port
    // fanned out to everything. A distribution panel hands out one cable per
    // socket, so its eight circuits leave from eight different ports and head
    // down the same aisle — matching per-port would make the second one
    // illegal and force every panel's circuits to leave on separate rows. Real
    // ones are bundled in a tray out of the panel; matching per-device says so.
    let skipEndpoint = false;
    const sharedNewIndices = [];
    const sharedExistingIndices = [];
    // Distinct fittings on the same manifold/device may sit inside one
    // service-clearance envelope. Exempt only that local envelope; once the
    // runs leave the device they must separate like every other rigid line.
    for (const [side, ref] of [['start', opts.start], ['end', opts.end]]) {
      if (!ref) continue;
      for (const [lineRef, oldIndex] of [[line.start, 0], [line.end, -1]]) {
        if (!lineRef || lineRef.placeableId !== ref.placeableId) continue;
        sharedNewIndices.push(side === 'start' ? 0 : newExpanded.length - 1);
        sharedExistingIndices.push(oldIndex);
      }
    }
    if (ignoreSharedSource) {
      const shares = (ref, ignore) => !!(ignore && ref && ref.placeableId === ignore.placeableId);
      for (const [side, ignore] of [['start', ignoreSharedSource.start], ['end', ignoreSharedSource.end]]) {
        if (!ignore) continue;
        if (shares(line.start, ignore)) {
          skipEndpoint = true;
          sharedNewIndices.push(side === 'start' ? 0 : newExpanded.length - 1);
          sharedExistingIndices.push(0);
        }
        if (shares(line.end, ignore)) {
          skipEndpoint = true;
          sharedNewIndices.push(side === 'start' ? 0 : newExpanded.length - 1);
          sharedExistingIndices.push(-1); // resolved once existing is expanded
        }
      }
    }
    // Fanout: lines that share a source endpoint are allowed to overlap / share
    // trunk subtiles — they will be merged into one network via spatial union
    // and capacity will be divided among sinks. Skip overlap check entirely
    // for that existing line.
    // Loose lines may share a tray out of a common source. A rigid service may
    // share the connector point but cannot be laid invisibly inside an already
    // installed pipe/guide; its next subtile must choose another plan route.
    if (skipEndpoint && !usesFixedRouteHeight(utilityType)) continue;
    const existing = expandPath(line.path || []);
    for (let k = 0; k < sharedExistingIndices.length; k++) {
      if (sharedExistingIndices[k] < 0) sharedExistingIndices[k] = existing.length - 1;
    }
    const exempt = tapExempt.get(line.id) || null;
    for (let i = 0; i < newExpanded.length; i++) {
      if (exempt && exempt.has(i)) continue;
      const np = newExpanded[i];
      const newTerminal = i === 0 || i === newExpanded.length - 1;
      for (let j = 0; j < existing.length; j++) {
        if (!pointsOverlap(np, existing[j], clearanceTiles, physicalConflict)) continue;
        if (physicalConflict && sharedNewIndices.length > 0) {
          let insideSharedFitting = false;
          const fittingRadius = clearanceTiles * 2;
          for (let k = 0; k < sharedNewIndices.length; k++) {
            const newTerminal = newExpanded[sharedNewIndices[k]];
            const oldTerminal = existing[sharedExistingIndices[k]];
            if (!newTerminal || !oldTerminal) continue;
            // The physical fitting clearance itself is axis-aligned (the same
            // square used by pointsOverlap), so its local exemption must use
            // Chebyshev distance too. Manhattan distance incorrectly excluded
            // the square's diagonal corner and boxed a second branch inside a
            // shared source fitting.
            const newDistance = Math.max(
              Math.abs(np.col - newTerminal.col),
              Math.abs(np.row - newTerminal.row),
            );
            const oldDistance = Math.max(
              Math.abs(existing[j].col - oldTerminal.col),
              Math.abs(existing[j].row - oldTerminal.row),
            );
            if (newDistance <= fittingRadius + EPS && oldDistance <= fittingRadius + EPS) {
              insideSharedFitting = true;
              break;
            }
          }
          if (insideSharedFitting) continue;
        }
        // A rigid tee owns a small junction envelope around the contact. Let
        // the new branch travel radially out of that envelope before normal
        // lane clearance resumes. Collinear departure is never exempt — that
        // would still be laying a second pipe invisibly inside the trunk.
        if (physicalConflict && exempt) {
          const startTap = exempt.has(0);
          const endTap = exempt.has(newExpanded.length - 1);
          const terminalIndex = startTap ? 0 : endTap ? newExpanded.length - 1 : -1;
          const terminal = terminalIndex >= 0 ? newExpanded[terminalIndex] : null;
          const nearTerminal = terminal
            && Math.abs(np.col - terminal.col) + Math.abs(np.row - terminal.row)
              <= clearanceTiles + EPS;
          if (nearTerminal && isPerpendicular(
            axesAtIndex(newExpanded, terminalIndex), axesAtIndex(existing, j))) continue;
        }
        if (skipEndpoint && i === 0 && (j === 0 || j === existing.length - 1)) continue;
        // Endpoint contact is a JOIN, and a join has to be asked for: an
        // unexempted one (this end named no tap, or the utility allows none)
        // is refused rather than quietly wiring two networks together.
        if (newTerminal || j === 0 || j === existing.length - 1) {
          return sameType ? 'overlap_same_type' : 'overlap_rigid_service';
        }
        // Interior/interior: legal exactly when the runs cross.
        // Installed fixed-height services occupy one physical elevation, so even a
        // perpendicular centreline crossing is a collision. Cables retain the
        // old bridge-over behavior.
        if (physicalConflict
          || !isPerpendicular(axesAtIndex(newExpanded, i), axesAtIndex(existing, j))) {
          return sameType ? 'overlap_same_type' : 'overlap_rigid_service';
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

// Endpoints include the components carried on beam pipes, not just
// state.placeables — see utility/utility-endpoints.js.
function findPlaceable(state, id) {
  return findUtilityEndpoint(state, id);
}

function lookupDef(state, type) {
  if (state && state.defs) {
    // Both Map and plain object are acceptable.
    if (typeof state.defs.get === 'function') return state.defs.get(type) || null;
    return state.defs[type] || null;
  }
  return (type && COMPONENTS[type]) || null;
}

function resolvedLineWaterCircuit(state, line) {
  const authored = lineWaterCircuit(line);
  if (authored) return authored;
  const circuits = new Set();
  for (const ref of [line?.start, line?.end]) {
    if (!ref) continue;
    const endpoint = findPlaceable(state, ref.placeableId);
    const spec = getPortSpec(lookupDef(state, endpoint?.type), ref.portName);
    const circuit = portWaterCircuit(spec);
    if (circuit) circuits.add(circuit);
  }
  return circuits.size === 1 ? [...circuits][0] : null;
}

/** True only for a suspended HV span whose two ends are elevated supports. */
function isOverheadHvSupportSpan(state, utilityType, start, end) {
  if (utilityType !== 'hvCable' || !start || !end) return false;
  return [start, end].every((ref) => {
    const endpoint = findPlaceable(state, ref.placeableId);
    return endpoint && isOverheadHvSupport(lookupDef(state, endpoint.type), ref.portName);
  });
}

// Electrical distribution is intentionally radial. The generic utility graph
// permits sources to merge (correct for fluid headers and some RF layouts),
// but connecting two live outputs is a backfeed, not a useful power run. HV
// uses source/sink/pass roles directly; branch power retains narrower stage
// names for busways, field boxes and transfer switches.
//
// `connectionKind` is optional so old content and small test fixtures retain
// their natural source -> sink behavior. Power infrastructure opts into the
// narrower stage names in utility-ports-v2.js.
function connectionKind(spec, utilityType) {
  if (spec && spec.connectionKind) return spec.connectionKind;
  if (utilityType === 'hvCable') {
    return spec?.role === 'source' ? 'hvSupplyOut' : 'hvDistributionIn';
  }
  if (utilityType === 'powerCable') {
    return spec?.role === 'source' ? 'powerDistributionOut' : 'powerLoadIn';
  }
  return null;
}

function oneOfPair(a, b, x, y) {
  return (a === x && b === y) || (a === y && b === x);
}

function portsCanConnect(startSpec, endSpec, utilityType) {
  if (!startSpec || !endSpec) return true; // open utility runs remain legal
  if (utilityType === 'hvCable') {
    // HV validity follows electrical roles, not authored stage-name pairs.
    // Passive terminals on poles, towers, switches, vaults and wall bushings
    // are interchangeable conductor supports. Distribution gear retains its
    // source/sink roles, so live outputs still cannot backfeed one another and
    // two loads still cannot be tied together.
    if (startSpec.role === 'source' && endSpec.role === 'source') return false;
    if (startSpec.role === 'sink' && endSpec.role === 'sink') return false;
    return true;
  }
  if (utilityType === 'powerCable') {
    const a = connectionKind(startSpec, utilityType);
    const b = connectionKind(endSpec, utilityType);
    return oneOfPair(a, b, 'powerDistributionOut', 'powerLoadIn')
      || oneOfPair(a, b, 'powerDistributionOut', 'powerFieldIn')
      || oneOfPair(a, b, 'powerFieldOut', 'powerLoadIn')
      // A portable spider box has no privileged feeder socket: any one of its
      // four sockets may face the panel, and any remaining socket may face a
      // load. Field-port to field-port stays illegal, preserving the radial
      // no-chaining/no-backfeed rule.
      || oneOfPair(a, b, 'powerDistributionOut', 'powerFieldPort')
      || oneOfPair(a, b, 'powerFieldPort', 'powerLoadIn')
      || oneOfPair(a, b, 'powerDistributionOut', 'powerPassThroughIn')
      || oneOfPair(a, b, 'powerFieldOut', 'powerPassThroughIn')
      || oneOfPair(a, b, 'powerFieldPort', 'powerPassThroughIn')
      || oneOfPair(a, b, 'powerPassThroughOut', 'powerLoadIn')
      || oneOfPair(a, b, 'powerPassThroughOut', 'powerFieldIn')
      || oneOfPair(a, b, 'powerPassThroughOut', 'powerFieldPort')
      || oneOfPair(a, b, 'powerPassThroughOut', 'powerPassThroughIn')
      // A transfer switch keeps normal and standby sources physically
      // separate. Only its selected internal contact joins one input to the
      // protected output; the line validator never permits a source-to-source
      // tie outside the device.
      || oneOfPair(a, b, 'powerDistributionOut', 'powerTransferNormalIn')
      || oneOfPair(a, b, 'powerFieldOut', 'powerTransferNormalIn')
      || oneOfPair(a, b, 'powerFieldPort', 'powerTransferNormalIn')
      || oneOfPair(a, b, 'powerPassThroughOut', 'powerTransferNormalIn')
      || oneOfPair(a, b, 'powerAlternateSourceOut', 'powerTransferBackupIn')
      || oneOfPair(a, b, 'powerTransferOut', 'powerLoadIn')
      || oneOfPair(a, b, 'powerTransferOut', 'powerFieldIn')
      || oneOfPair(a, b, 'powerTransferOut', 'powerFieldPort')
      || oneOfPair(a, b, 'powerTransferOut', 'powerPassThroughIn');
  }
  return true;
}

/** Does any line of this utility already touch this device? */
function deviceHasLine(state, placeableId, utilityType) {
  const lines = state && state.utilityLines;
  const iter = lines && typeof lines.values === 'function' ? lines.values() : (lines || []);
  for (const line of iter) {
    if (!line || line.utilityType !== utilityType) continue;
    if (line.start && line.start.placeableId === placeableId) return true;
    if (line.end && line.end.placeableId === placeableId) return true;
  }
  return false;
}

function portConnectionCount(state, placeableId, portName) {
  const lines = state && state.utilityLines;
  const iter = lines && typeof lines.values === 'function'
    ? lines.values()
    : (lines || []);
  let count = 0;
  for (const line of iter) {
    if (!line) continue;
    if (line.start && line.start.placeableId === placeableId && line.start.portName === portName) {
      count++;
    }
    if (line.end && line.end.placeableId === placeableId && line.end.portName === portName) {
      count++;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Public: validateDrawLine
// ---------------------------------------------------------------------------

export function validateDrawLine(state, {
  utilityType, start, end, path, tapLineIds, cablePath, waterCircuit = null,
} = {}) {
  // Path shape.
  if (!Array.isArray(path) || path.length < 2) return reject('invalid_path');
  if (path.some(point => !point
      || !isUtilityRouteCoordinate(point.col)
      || !isUtilityRouteCoordinate(point.row))) return reject('off_subtile_grid');
  if (!isManhattanPath(path)) return reject('not_manhattan');

  // Require at least one non-degenerate segment.
  let totalDist = 0;
  for (let i = 0; i < path.length - 1; i++) {
    totalDist += Math.abs(path[i + 1].col - path[i].col)
              + Math.abs(path[i + 1].row - path[i].row);
  }
  // Co-located fittings can connect for every utility; their exact 3D anchors
  // and local transitions still produce visible geometry. An open zero-length
  // mark has no topology or useful presentation and remains invalid.
  if (totalDist < EPS && !(start && end)) return reject('invalid_path');

  const descriptor = UTILITY_TYPES[utilityType] || {};
  const freeform = isSoftCable(utilityType) ? sanitizeCablePath(cablePath) : [];
  // Soft utilities are physical where the player visibly laid them. Their
  // compatibility path must not let a cable or hose pass through a wall (or
  // reject one whose visible trace went around it).
  const physicalPath = freeform.length >= 2
    ? roundedCableTilePath(freeform, utilityType)
    : path;
  if (descriptor.requiresWallPassThrough
      && !isOverheadHvSupportSpan(state, utilityType, start, end)
      && pathCrossesWall(state?.wallOccupied, physicalPath)) {
    return reject('wall_pass_through_required');
  }
  let startSpec = null;
  let endSpec = null;

  // Resolve start endpoint.
  if (start) {
    if (!start.placeableId || !start.portName) return reject('invalid_start');
    const p = findPlaceable(state, start.placeableId);
    if (!p) return reject('invalid_start');
    const def = lookupDef(state, p.type);
    if (!def) return reject('invalid_start');
    const spec = getPortSpec(def, start.portName);
    if (!spec) return reject('invalid_start');
    if (spec.utility !== utilityType) return reject('port_type_mismatch');
    startSpec = spec;
    if (portConnectionCount(state, start.placeableId, start.portName)
        >= utilityPortConnectionLimit(spec, utilityType)) return reject('port_taken');

  }

  // Resolve end endpoint.
  if (end) {
    if (!end.placeableId || !end.portName) return reject('invalid_end');
    const p = findPlaceable(state, end.placeableId);
    if (!p) return reject('invalid_end');
    const def = lookupDef(state, p.type);
    if (!def) return reject('invalid_end');
    const spec = getPortSpec(def, end.portName);
    if (!spec) return reject('invalid_end');
    if (spec.utility !== utilityType) return reject('port_type_mismatch');
    endSpec = spec;
    if (portConnectionCount(state, end.placeableId, end.portName)
        >= utilityPortConnectionLimit(spec, utilityType)) return reject('port_taken');

  }

  // Interchangeable spider-box sockets would otherwise accept a meaningless
  // cable back into the same box and consume two sockets. Keep this check
  // specific to field ports so legacy same-device lines for other utilities
  // can still be re-anchored when their host moves.
  if (start && end && start.placeableId === end.placeableId
      && (utilityType === 'hvCable'
        || connectionKind(startSpec, utilityType) === 'powerFieldPort'
        || connectionKind(endSpec, utilityType) === 'powerFieldPort')) {
    return reject('invalid_port_pair');
  }

  if (!portsCanConnect(startSpec, endSpec, utilityType)) {
    return reject('invalid_port_pair');
  }

  // Hot return and cold supply share the same construction tools but are
  // distinct hydraulic circuits. Infer a new run from its exact terminal or
  // tapped trunk, then refuse any gesture that would short the two together.
  let resolvedWaterCircuit = isWaterUtility(utilityType) ? waterCircuit : null;
  if (isWaterUtility(utilityType)) {
    const circuits = new Set();
    for (const circuit of [
      resolvedWaterCircuit,
      portWaterCircuit(startSpec),
      portWaterCircuit(endSpec),
    ]) {
      if (circuit) circuits.add(circuit);
    }
    for (const id of [tapLineIds?.start, tapLineIds?.end]) {
      const target = id && state?.utilityLines?.get?.(id);
      const circuit = resolvedLineWaterCircuit(state, target);
      if (circuit) circuits.add(circuit);
    }
    if (circuits.size > 1) return reject('water_circuit_mismatch');
    resolvedWaterCircuit = circuits.size === 1 ? [...circuits][0] : null;
  }

  // Overlap against same-type lines only — branching at a shared source or a
  // directionless bus peer is allowed. Interior overlaps still block.
  const lines = state && state.utilityLines;
  // Build ignore set for branching: if start/end is a source that is already taken,
  // that endpoint is a fanout point and its exact endpoint overlap is permitted.
  let ignoreSharedSource = null;
  for (const [ref, side] of [[start, 'start'], [end, 'end']]) {
    if (!ref) continue;
    const rec = findPlaceable(state, ref.placeableId);
    const def = rec ? lookupDef(state, rec.type) : null;
    const spec = def ? getPortSpec(def, ref.portName) : null;
    // A source end, on a device that already has a line of this utility on it.
    // Whether THIS port is the taken one no longer matters: the bundle leaves
    // the device, not the socket.
    // A field distributor's outlets are passive pass ports, but physically
    // they leave the same raceway as its incoming feeder. Treat those outlets
    // like sources for the limited shared-device tray exemption only; they
    // remain single-use ports and never gain source semantics in the solver.
    if (!spec || (descriptor.topology !== 'bus' && spec.role !== 'source'
        && connectionKind(spec, utilityType) !== 'powerFieldOut'
        && connectionKind(spec, utilityType) !== 'powerFieldPort')) continue;
    if (!deviceHasLine(state, ref.placeableId, utilityType)) continue;
    ignoreSharedSource = ignoreSharedSource || {};
    ignoreSharedSource[side] = ref;
  }
  // Loose electrical and data cords may cross on the floor without joining.
  // Cooling hoses are equally smooth, but remain plumbed networks. Their grid
  // route keeps deterministic join clearance while the visible route supplies
  // the exact network contact positions in discovery.
  let resolvedRouteHeight = utilityType === 'waterSupplyPipe'
    ? descriptor.runHeightsByWaterCircuit?.[resolvedWaterCircuit]
      ?? descriptor.runHeightMeters
    : null;
  if (!softCableSkipsOverlap(utilityType)) {
    if (usesFixedRouteHeight(utilityType)) {
      // Ignore caller- or save-authored lane values. One utility means one
      // physical elevation; endpoint hardware meets it through a local riser.
      resolvedRouteHeight = utilityLineHeight(utilityType, resolvedRouteHeight);
      const overlapReason = pathOverlapReason(path, lines, utilityType, {
        ignoreSharedSource, tapLineIds, start, end,
        routeHeightMeters: resolvedRouteHeight, waterCircuit: resolvedWaterCircuit,
        resolveWaterCircuit: line => resolvedLineWaterCircuit(state, line),
      });
      if (overlapReason) return reject(overlapReason);
    } else {
      const overlapReason = pathOverlapReason(
        path, lines, utilityType, {
          ignoreSharedSource, tapLineIds, start, end,
          waterCircuit: resolvedWaterCircuit,
          resolveWaterCircuit: line => resolvedLineWaterCircuit(state, line),
        });
      if (overlapReason) return reject(overlapReason);
    }
  }

  // Every service uses the same measured 3D collision check. A footprint is
  // only the broad phase: empty space beneath/inside a compound beamline model
  // remains routable, while a real mesh intersection asks the player/router to
  // use the neighboring subtile. Endpoint models are exempt because their
  // perimeter transition owns the final wrap into the fitting.
  if (usesFlexibleSubtileRouting(descriptor)) {
    // For soft utilities the freehand trace is the body the player sees and
    // therefore the body that must clear solid equipment. The compatibility
    // Manhattan path remains useful for endpoints and non-freeform topology,
    // but it must neither block a visible detour nor hide a visible collision.
    const expanded = freeform.length >= 2
      ? samplePhysicalPath(physicalPath)
      : expandPath(path);
    const obstacles = buildUtilityRouteObstacles(state, utilityType, {
      startRef: start, endRef: end, includeLines: false,
      equipmentPoints: expanded,
      routeHeightMeters: resolvedRouteHeight,
    });
    for (const point of expanded) {
      if (obstacles.isBlocked(point.col, point.row)) {
        return reject('blocked_by_equipment');
      }
    }
  }

  return {
    ok: true,
    line: {
      utilityType,
      start: start || null,
      end: end || null,
      path: path.map(pt => ({ col: pt.col, row: pt.row })),
      ...(Number.isFinite(resolvedRouteHeight)
        ? { routeHeightMeters: resolvedRouteHeight }
        : {}),
      ...(freeform.length >= 2 ? { cablePath: freeform } : {}),
      ...(resolvedWaterCircuit ? { waterCircuit: resolvedWaterCircuit } : {}),
      ...((tapLineIds?.start || tapLineIds?.end)
        ? { tapLineIds: { start: tapLineIds.start || null, end: tapLineIds.end || null } }
        : {}),
      subL: freeform.length >= 2
        ? cablePathLengthSubUnits(freeform)
        : pathLengthSubUnits(path),
    },
  };
}

// Re-export reason codes as a convenience for callers who want to pattern-match
// without magic strings.
export const REASONS = Object.freeze({
  invalid_path: 'invalid_path',
  off_subtile_grid: 'off_subtile_grid',
  not_manhattan: 'not_manhattan',
  overlap_same_type: 'overlap_same_type',
  overlap_rigid_service: 'overlap_rigid_service',
  blocked_by_equipment: 'blocked_by_equipment',
  wall_pass_through_required: 'wall_pass_through_required',
  invalid_start: 'invalid_start',
  invalid_end: 'invalid_end',
  port_type_mismatch: 'port_type_mismatch',
  port_taken: 'port_taken',
  invalid_port_pair: 'invalid_port_pair',
  water_circuit_mismatch: 'water_circuit_mismatch',
});
