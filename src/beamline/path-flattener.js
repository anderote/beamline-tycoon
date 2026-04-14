// src/beamline/path-flattener.js
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

import { COMPONENTS } from '../data/components.js';

/**
 * Flatten a source→endpoint path through the pipe graph.
 *
 * @param {Object} gameState - game.state (reads placeables + beamPipes)
 * @param {string} sourceId - placeable id of the source module to start from
 * @param {string} [endpointId] - optional endpoint id; if omitted, walks
 *   until the first endpoint component or end of pipe chain
 * @returns {Array} ordered entries, each with:
 *   { kind: 'module', id, type, params, beamStart, subL, placeable }
 *   { kind: 'attachment', id, type, params, beamStart, subL, pipeId, position }
 *   { kind: 'drift', id, beamStart, subL, pipeId }
 */
export function flattenPath(gameState, sourceId, endpointId = null) {
  const placeableById = {};
  for (const p of gameState.placeables) placeableById[p.id] = p;

  // Directed adjacency: follow pipes fromId → toId.
  const outEdges = {};
  for (const pipe of gameState.beamPipes || []) {
    if (!outEdges[pipe.fromId]) outEdges[pipe.fromId] = [];
    outEdges[pipe.fromId].push(pipe);
  }

  const result = [];
  let beamStart = 0;

  let currentId = sourceId;
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
    beamStart += subL * 0.5; // advance in metres

    // If we've reached the requested endpoint, stop
    if (endpointId && placeable.id === endpointId) break;

    // If this is an endpoint component and no target specified, stop
    if (!endpointId && def && def.isEndpoint) break;

    // Pick next pipe: single-path linac, exactly one outgoing edge.
    const edges = outEdges[currentId] || [];
    if (edges.length === 0) break;

    const pipe = edges[0];

    // Emit attachments + drift interleaved. Attachments are sorted by position.
    const atts = [...(pipe.attachments || [])].sort((a, b) => a.position - b.position);
    const pipeBeamLen = pipe.subL * 0.5; // metres

    let pipeCursor = beamStart;
    let attCursor = 0; // metres consumed so far on this pipe

    for (const att of atts) {
      const attDef = COMPONENTS[att.type];
      const attSubL = attDef ? (attDef.subL || 1) : 1;
      const attBeamLen = attSubL * 0.5;

      // Drift segment leading up to this attachment
      const targetPos = att.position * pipeBeamLen;
      const driftBeamLen = targetPos - attCursor;
      if (driftBeamLen > 0) {
        result.push({
          kind: 'drift',
          id: pipe.id + '_d' + attCursor.toFixed(3),
          beamStart: pipeCursor,
          subL: driftBeamLen * 2, // metres → sub-units
          pipeId: pipe.id,
        });
        pipeCursor += driftBeamLen;
        attCursor += driftBeamLen;
      }

      // The attachment itself
      result.push({
        kind: 'attachment',
        id: att.id,
        type: att.type,
        params: att.params || {},
        beamStart: pipeCursor,
        subL: attSubL,
        pipeId: pipe.id,
        position: att.position,
      });
      pipeCursor += attBeamLen;
      attCursor += attBeamLen;
    }

    // Remaining drift to end of pipe
    const tailBeamLen = pipeBeamLen - attCursor;
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
    currentId = pipe.toId;
  }

  return result;
}
