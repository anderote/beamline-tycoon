// src/beamline/flattener.js
//
// ---------------------------------------------------------------------------
// PHYSICS CONTRACT — read before modifying
//
// The flattener is the single source of truth for beam element ordering.
// Game._deriveBeamGraph(), _recalcSingleBeamline(), and BeamlineDesigner's
// edit mode all call flattenPath() and consume its output directly.
//
// Every entry has:
//   - beamStart: cumulative METRE position of the element's START from the source
//   - subL:      element length in sub-units (1 sub-unit = 0.5 m)
//
// Invariant: envelope[i].s (metres) === entries[i].beamStart (metres)
//            for every physics-generated envelope snapshot.
// ---------------------------------------------------------------------------
//
// Cycle-aware walker over the new pipe/junction graph:
//   - Pipes: { id, start: {junctionId, portName} | null, end: ..., path,
//             subL, placements: [{ id, type, position, subL, params }] }
//   - Junctions: placeables with COMPONENTS[type].role === 'junction', having
//     a `routing: [{ from, to, fraction?, tunable? }]` table.
//   - Source: routing === [], exactly one exit port.
//   - Endpoint: routing === [], no outgoing edges.
//   - 2-port: routing maps the entry port to the exit port.
//   - Splitter: multiple routing entries; we pick the dominant path
//     (fraction === 1.0 if present, else the first entry).
//   - Injection septum / merger: routing has multiple entries converging to a
//     single exit — arrival port determines which entry fires.
//
// Cycle detection: we key on `pipeId:direction` where direction is 'forward'
// if walking from pipe.start toward pipe.end, 'reverse' otherwise. Re-entering
// the same pipe in the same direction stops the walk.

import { COMPONENTS } from '../data/components.js';

/**
 * @param {Object} gameState  game.state (reads placeables + beamPipes)
 * @param {string} sourceId   placeable id of the source junction to start from
 * @param {Object} [opts]     reserved for future options
 * @returns {Array} ordered entries:
 *   { kind: 'module',    id, type, params, beamStart, subL, placeable }
 *   { kind: 'placement', id, type, params, beamStart, subL, pipeId, position }
 *   { kind: 'drift',     id, beamStart, subL, pipeId }
 */
export function flattenPath(gameState, sourceId, opts = {}) {
  const placeableById = {};
  for (const p of gameState.placeables || []) placeableById[p.id] = p;

  const pipes = gameState.beamPipes || [];

  const result = [];
  let beamStart = 0;

  const walkedPipes = new Set();

  let currentId = sourceId;
  // Port we ARRIVED at on currentId. null for the source (there is no arrival).
  let arrivalPort = null;

  while (currentId) {
    const placeable = placeableById[currentId];
    if (!placeable) break;
    const def = COMPONENTS[placeable.type];
    const subL = def ? (def.subL || 4) : 4;

    result.push({
      kind: 'module',
      id: placeable.id,
      type: placeable.type,
      params: placeable.params || {},
      beamStart,
      subL,
      placeable,
    });
    beamStart += subL * 0.5;

    // Pick outgoing port via routing.
    const outgoingPort = pickOutgoingPort(def, arrivalPort);
    if (!outgoingPort) break;

    // Find the pipe attached to this junction via outgoingPort.
    const pipeInfo = findPipeAt(pipes, currentId, outgoingPort);
    if (!pipeInfo) break;
    const { pipe, direction } = pipeInfo;

    const pipeKey = pipe.id + ':' + direction;
    if (walkedPipes.has(pipeKey)) break;
    walkedPipes.add(pipeKey);

    // Emit drift/placement entries along this pipe.
    // Placements are sorted by `position` (0..1 along the pipe).
    const placements = [...(pipe.placements || [])].sort((a, b) => a.position - b.position);
    const pipeBeamLen = pipe.subL * 0.5;

    let pipeCursor = beamStart;
    let consumed = 0; // metres consumed on this pipe so far

    for (const pl of placements) {
      const plSubL = pl.subL != null
        ? pl.subL
        : (COMPONENTS[pl.type] ? (COMPONENTS[pl.type].subL || 1) : 1);
      const plBeamLen = plSubL * 0.5;

      const targetPos = pl.position * pipeBeamLen;
      const driftBeamLen = targetPos - consumed;
      if (driftBeamLen > 0) {
        result.push({
          kind: 'drift',
          id: pipe.id + '_d' + consumed.toFixed(3),
          beamStart: pipeCursor,
          subL: driftBeamLen * 2,
          pipeId: pipe.id,
        });
        pipeCursor += driftBeamLen;
        consumed += driftBeamLen;
      }

      result.push({
        kind: 'placement',
        id: pl.id,
        type: pl.type,
        params: pl.params || {},
        beamStart: pipeCursor,
        subL: plSubL,
        pipeId: pipe.id,
        position: pl.position,
      });
      pipeCursor += plBeamLen;
      consumed += plBeamLen;
    }

    // Trailing drift to far end of pipe.
    const tailBeamLen = pipeBeamLen - consumed;
    if (tailBeamLen > 0) {
      result.push({
        kind: 'drift',
        id: pipe.id + '_dtail',
        beamStart: pipeCursor,
        subL: tailBeamLen * 2,
        pipeId: pipe.id,
      });
      pipeCursor += tailBeamLen;
    }

    beamStart = pipeCursor;

    // Step off the far end of the pipe.
    const farEnd = direction === 'forward' ? pipe.end : pipe.start;
    if (!farEnd) break;

    currentId = farEnd.junctionId;
    arrivalPort = farEnd.portName;
  }

  return result;
}

// Pick the outgoing port on a junction given the arrival port.
//
// - Empty routing ([]) with an `exit` port side: sole exit port (source). If the
//   node has no `exit` and arrivalPort is set, treat as dead-end (endpoint).
// - Non-empty routing: find entry where `from === arrivalPort`. If multiple match
//   (shouldn't normally, but a splitter after arrival), prefer fraction===1.0
//   else the first entry.
// - If arrivalPort is null (source): pick the first routing entry's `to`, or the
//   first port in `ports`.
function pickOutgoingPort(def, arrivalPort) {
  if (!def) return null;
  const routing = def.routing;
  const ports = def.ports || {};

  // Source-style (no routing) — pick the sole exit port.
  if (!routing || routing.length === 0) {
    if (arrivalPort != null) return null;
    const portNames = Object.keys(ports);
    if (portNames.length === 0) return null;
    return portNames[0];
  }

  // Arrived without a port (source case with non-empty routing is unusual) —
  // fall back to the dominant entry's `to`.
  if (arrivalPort == null) {
    const dominant = pickDominantEntry(routing);
    return dominant ? dominant.to : null;
  }

  const matches = routing.filter(r => r.from === arrivalPort);
  if (matches.length === 0) return null;
  const dominant = pickDominantEntry(matches);
  return dominant ? dominant.to : null;
}

function pickDominantEntry(entries) {
  if (!entries || entries.length === 0) return null;
  const full = entries.find(r => r.fraction === 1.0);
  return full || entries[0];
}

// Find the pipe connected to (junctionId, portName).
// Returns { pipe, direction } where direction is 'forward' if walking from
// pipe.start toward pipe.end (we are AT pipe.start), 'reverse' otherwise.
function findPipeAt(pipes, junctionId, portName) {
  for (const pipe of pipes) {
    if (pipe.start && pipe.start.junctionId === junctionId && pipe.start.portName === portName) {
      return { pipe, direction: 'forward' };
    }
    if (pipe.end && pipe.end.junctionId === junctionId && pipe.end.portName === portName) {
      return { pipe, direction: 'reverse' };
    }
  }
  return null;
}
