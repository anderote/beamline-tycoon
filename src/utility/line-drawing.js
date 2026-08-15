// src/utility/line-drawing.js
//
// Pure validator for drawing a utility line between two ports. Mirrors the
// shape of src/beamline/pipe-drawing.js but with these differences:
//   - Paths may contain 90° Manhattan bends (no diagonals).
//   - Overlap is checked only against existing lines of the SAME utilityType
//     (different utilities route independently).
//   - Endpoints reference placeables via `placeableId` (not `junctionId`).
//   - Rejection reasons are utility-specific and distinguish start/end port
//     alignment failures.
//
// Rejection reasons:
//   invalid_path, not_manhattan, overlap_same_type,
//   invalid_start, invalid_end, port_type_mismatch, port_taken,
//   port_mismatch_start, port_mismatch_end.

import { COMPONENTS } from '../data/components.js';
import { UTILITY_TYPES } from './registry.js';
import {
  getPortSpec,
  availablePorts,
} from './ports.js';
import {
  pathLengthSubUnits,
  expandPath,
} from './line-geometry.js';
import { findUtilityEndpoint } from './utility-endpoints.js';

const EPS = 1e-6;

function reject(reason) { return { ok: false, reason }; }

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

function segmentDirection(a, b) {
  const dCol = b.col - a.col;
  const dRow = b.row - a.row;
  if (Math.abs(dCol) > EPS && Math.abs(dRow) < EPS) {
    return { dCol: Math.sign(dCol), dRow: 0 };
  }
  if (Math.abs(dRow) > EPS && Math.abs(dCol) < EPS) {
    return { dCol: 0, dRow: Math.sign(dRow) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Overlap check (same-type only).
// ---------------------------------------------------------------------------

function pointsOverlap(a, b) {
  return Math.abs(a.col - b.col) < 0.25 - EPS
      && Math.abs(a.row - b.row) < 0.25 - EPS;
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
//                                                declares allowsTap (pipes get
//                                                a fitting; cables, waveguides
//                                                and fibres are terminated at
//                                                both ends), and then only via
//                                                the tapLineIds exemption.
//   interior of both, perpendicular              a crossing: one passes over
//                                                the other, never joined.
//                                                Always legal.
//   interior of both, collinear                  laying down an existing run.
//                                                Never legal.
//
// discoverNetworks' spatial union is narrowed to match (endpoint contact only),
// so a crossing cannot silently merge two networks.
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

function pathOverlapsSameType(newPath, lines, utilityType, opts = {}) {
  const newExpanded = expandPath(newPath);
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
    if (!line || line.utilityType !== utilityType) continue;
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
    if (ignoreSharedSource) {
      const shares = (ref, ignore) => !!(ignore && ref && ref.placeableId === ignore.placeableId);
      for (const ignore of [ignoreSharedSource.start, ignoreSharedSource.end]) {
        if (shares(line.start, ignore) || shares(line.end, ignore)) skipEndpoint = true;
      }
    }
    // Fanout: lines that share a source endpoint are allowed to overlap / share
    // trunk subtiles — they will be merged into one network via spatial union
    // and capacity will be divided among sinks. Skip overlap check entirely
    // for that existing line.
    if (skipEndpoint) continue;
    const existing = expandPath(line.path || []);
    const exempt = tapExempt.get(line.id) || null;
    for (let i = 0; i < newExpanded.length; i++) {
      if (exempt && exempt.has(i)) continue;
      const np = newExpanded[i];
      const newTerminal = i === 0 || i === newExpanded.length - 1;
      for (let j = 0; j < existing.length; j++) {
        if (!pointsOverlap(np, existing[j])) continue;
        // Endpoint contact is a JOIN, and a join has to be asked for: an
        // unexempted one (this end named no tap, or the utility allows none)
        // is refused rather than quietly wiring two networks together.
        if (newTerminal || j === 0 || j === existing.length - 1) return true;
        // Interior/interior: legal exactly when the runs cross.
        if (!isPerpendicular(axesAtIndex(newExpanded, i), axesAtIndex(existing, j))) {
          return true;
        }
      }
    }
  }
  return false;
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

/**
 * May a port that already has a line take another?
 *
 * Only a source, and only for a utility whose runs fan out — a manifold outlet
 * feeds several branches, a power socket takes one plug. Mirrors
 * ports.availablePorts, which decides whether the marker is even offered; both
 * have to agree or the player can grab a port the commit then refuses.
 */
function portReusable(spec, utilityType) {
  if (!spec || spec.role !== 'source') return false;
  const d = UTILITY_TYPES[utilityType];
  return !d || d.fansOut !== false;
}

// Power is intentionally radial. The generic utility graph permits sources to
// merge (correct for fluid headers and some RF layouts), but connecting two
// live panel outputs is a backfeed, not a useful power run. The port table
// expresses the stages; this validator makes them a real wiring rule.
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
    const a = connectionKind(startSpec, utilityType);
    const b = connectionKind(endSpec, utilityType);
    return oneOfPair(a, b, 'hvSupplyOut', 'hvDistributionIn')
      || oneOfPair(a, b, 'hvDistributionOut', 'hvDistributionIn')
      || oneOfPair(a, b, 'hvSupplyOut', 'hvLoadIn')
      || oneOfPair(a, b, 'hvDistributionOut', 'hvLoadIn');
  }
  if (utilityType === 'powerCable') {
    const a = connectionKind(startSpec, utilityType);
    const b = connectionKind(endSpec, utilityType);
    return oneOfPair(a, b, 'powerDistributionOut', 'powerLoadIn')
      || oneOfPair(a, b, 'powerDistributionOut', 'powerFieldIn')
      || oneOfPair(a, b, 'powerFieldOut', 'powerLoadIn');
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

function isPortTaken(state, placeableId, portName) {
  const lines = state && state.utilityLines;
  const iter = lines && typeof lines.values === 'function'
    ? lines.values()
    : (lines || []);
  for (const line of iter) {
    if (!line) continue;
    if (line.start && line.start.placeableId === placeableId && line.start.portName === portName) {
      return true;
    }
    if (line.end && line.end.placeableId === placeableId && line.end.portName === portName) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public: validateDrawLine
// ---------------------------------------------------------------------------

export function validateDrawLine(state, { utilityType, start, end, path, tapLineIds } = {}) {
  // Path shape.
  if (!Array.isArray(path) || path.length < 2) return reject('invalid_path');
  if (!isManhattanPath(path)) return reject('not_manhattan');

  // Require at least one non-degenerate segment.
  let totalDist = 0;
  for (let i = 0; i < path.length - 1; i++) {
    totalDist += Math.abs(path[i + 1].col - path[i].col)
              + Math.abs(path[i + 1].row - path[i].row);
  }
  if (totalDist < EPS) return reject('invalid_path');

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
    if (!portReusable(spec, utilityType)
        && isPortTaken(state, start.placeableId, start.portName)) return reject('port_taken');

    // Utility fittings identify the service and make the object readable; they
    // are not directional couplings.  A cable, hose, or fibre may leave a
    // fitting in whichever Manhattan direction gives the player a clean run.
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
    if (!portReusable(spec, utilityType)
        && isPortTaken(state, end.placeableId, end.portName)) return reject('port_taken');

    // See the start-port note above: utility lines do not require a prescribed
    // arrival direction at a fitting.
  }

  if (!portsCanConnect(startSpec, endSpec, utilityType)) {
    return reject('invalid_port_pair');
  }

  // Overlap against same-type lines only — branching at a shared source
  // endpoint is allowed (capacity-based fanout). Interior overlaps still block.
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
    if (!spec || (spec.role !== 'source'
        && connectionKind(spec, utilityType) !== 'powerFieldOut')) continue;
    if (!deviceHasLine(state, ref.placeableId, utilityType)) continue;
    ignoreSharedSource = ignoreSharedSource || {};
    ignoreSharedSource[side] = ref;
  }
  if (pathOverlapsSameType(path, lines, utilityType, { ignoreSharedSource, tapLineIds })) {
    return reject('overlap_same_type');
  }

  return {
    ok: true,
    line: {
      utilityType,
      start: start || null,
      end: end || null,
      path: path.map(pt => ({ col: pt.col, row: pt.row })),
      subL: pathLengthSubUnits(path),
    },
  };
}

// Re-export reason codes as a convenience for callers who want to pattern-match
// without magic strings.
export const REASONS = Object.freeze({
  invalid_path: 'invalid_path',
  not_manhattan: 'not_manhattan',
  overlap_same_type: 'overlap_same_type',
  invalid_start: 'invalid_start',
  invalid_end: 'invalid_end',
  port_type_mismatch: 'port_type_mismatch',
  port_taken: 'port_taken',
  port_mismatch_start: 'port_mismatch_start',
  port_mismatch_end: 'port_mismatch_end',
  invalid_port_pair: 'invalid_port_pair',
});
