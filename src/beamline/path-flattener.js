// src/beamline/path-flattener.js
//
// ---------------------------------------------------------------------------
// PHYSICS CONTRACT — read before modifying
//
// The flattener is the single source of truth for beam element ordering.
// Both the main map's Game._deriveBeamGraph() and BeamlineDesigner's edit
// mode call flattenPath() and consume its output directly. Any consumer
// that builds its own ordered list will desync from the physics envelope.
//
// Every entry has:
//   - beamStart: cumulative METRE position of the element's START from the source
//   - subL:      element length in sub-units (1 sub-unit = 0.5 m)
//
// Invariant: envelope[i].s (metres) === entries[i].beamStart (metres)
//            for every physics-generated envelope snapshot.
//
// When adding new entry kinds (e.g. splitter branches later), preserve
// the index-per-entry mapping so the designer plots stay aligned.
// ---------------------------------------------------------------------------

import { COMPONENTS } from '../data/components.js';

/**
 * Flatten a source→endpoint path through the pipe graph.
 *
 * @param {Object} gameState - game.state (reads placeables + beamPipes)
 * @param {string} sourceId - placeable id of the source module to start from
 * @param {string} [endpointId] - optional endpoint id; if omitted, picks the
 *   first reachable endpoint via BFS (works for single-path linacs)
 * @returns {Array} ordered entries, each with:
 *   { kind: 'module', id, type, params, beamStart, subL, placeable }
 *   { kind: 'attachment', id, type, params, beamStart, subL, pipeId, position }
 *   { kind: 'drift', id, beamStart, subL, pipeId }
 */
export function flattenPath(gameState, sourceId, endpointId = null) {
  const placeableById = {};
  for (const p of gameState.placeables) placeableById[p.id] = p;

  // Directed adjacency: follow pipes in the direction fromId → toId.
  // For linacs this is unambiguous. Reverse edges are included so the
  // walker can traverse pipes drawn toward the source if needed, but
  // this task keeps the logic linac-first and ignores reverse edges.
  const outEdges = {};
  for (const pipe of gameState.beamPipes || []) {
    if (!outEdges[pipe.fromId]) outEdges[pipe.fromId] = [];
    outEdges[pipe.fromId].push(pipe);
  }

  const result = [];
  const visited = new Set();
  let beamStart = 0;

  let currentId = sourceId;
  while (currentId) {
    if (visited.has(currentId)) break; // cycle — bail (rings come later)
    visited.add(currentId);

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

    // Pick next pipe: exactly one outgoing (linac). Skip pipes pointing
    // to already-visited modules.
    const edges = (outEdges[currentId] || []).filter(e => !visited.has(e.toId));
    if (edges.length === 0) break;

    // TODO(splitter): when splitters arrive, use pathHint to pick branches.
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

/**
 * Find all reachable endpoints from a source in the pipe graph.
 * Used by the designer to populate an endpoint selector for future
 * splitter support, and to validate source selection.
 *
 * @param {Object} gameState - game.state
 * @param {string} sourceId - placeable id of the source
 * @returns {Array} array of placeable objects that are reachable endpoints
 */
export function findReachableEndpoints(gameState, sourceId) {
  const placeableById = {};
  for (const p of gameState.placeables) placeableById[p.id] = p;

  const adj = {};
  for (const pipe of gameState.beamPipes || []) {
    if (!adj[pipe.fromId]) adj[pipe.fromId] = [];
    adj[pipe.fromId].push(pipe.toId);
  }

  const endpoints = [];
  const visited = new Set();
  const queue = [sourceId];
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    const p = placeableById[id];
    if (!p) continue;
    const def = COMPONENTS[p.type];
    if (def && def.isEndpoint) endpoints.push(p);
    for (const nxt of (adj[id] || [])) queue.push(nxt);
  }
  return endpoints;
}
