// src/utility/line-orientation.js
//
// Which physical end of a drawn utility line is actually closer to its
// network's SOURCE, independent of which end the player happened to click
// first while drawing. Feeds the flow-pulse renderer (utility-flow.js /
// utility-line-builder-v2.js): energy has to travel source -> sink regardless
// of draw order, or a waveguide drawn cavity-first would visibly flow
// backwards.
//
// Pure topology, no THREE — testable standalone. Mirrors (without importing,
// since it isn't exported) the SAME join rules network-discovery.js's
// discoverNetworks() uses to decide what's in one network in the first
// place, so "is this line part of the network" and "which way does it face"
// never disagree:
//   - port match: two lines' start/end share a literal port key
//     (network-discovery.js:383-398)
//   - spatial tap: an OPEN end lands on ANOTHER line's path — its own
//     terminal, or a point along that line's interior (a branch off a
//     header) — keyed by the same rounded-subtile scheme. Services authored
//     with joinsOnContact also join at interior/interior intersections.
//   - multi-port device continuity: a placeable with 2+ pass-through (or 2+
//     source) ports of this utility is one busbar/manifold behind the
//     faceplate, so lines landing on different named ports of it are as
//     adjacent as if they shared one port (network-discovery.js:433-465)
//
// Deliberately NOT modeled: adjacency bridging (bridgesAdjacent) and
// distribution-bus coverage, both of which put two placeables in the same
// NETWORK with no LINE between them at all — there is nothing for a
// line-to-line graph to walk there. Lines only reachable through one of
// those get no orientation entry and fall back to draw order (see the
// "unreached" note in computeLineOrientations below) — a documented boundary
// of what a per-line renderer effect can express, not a bug.

import { expandPath } from './line-geometry.js';
import { UTILITY_TYPES } from './registry.js';

function portKeyOf(ref) {
  return ref ? `${ref.placeableId}:${ref.portName}` : null;
}

function subtileKey(pt) {
  return `${Math.round(pt.col * 4)}/${Math.round(pt.row * 4)}`;
}

/**
 * Decide, for every line in one network, whether it needs to be rendered
 * REVERSED so that baked run-distance (bakeRunDistanceUVs /
 * bakeRunDistanceFromPositionZ) reads source -> sink instead of
 * line.start -> line.end.
 *
 * @param {{ id, utilityType, lineIds, ports, sources, sinks }} network
 *        one entry from state.utilityNetworks.get(utilityType) (see
 *        network-discovery.js's discoverNetworks/discoverAll).
 * @param {Map<string, UtilityLine>} linesById  state.utilityLines.
 * @param {{invertDirection?: boolean}} [options]
 *        Reverse the final physical direction while retaining the same robust
 *        source-rooted topology walk. Vacuum uses this: pumping capacity is a
 *        solver source, but visible gas travels back toward that pump.
 * @returns {Map<string, boolean>} lineId -> true if reversed. A line with NO
 *          entry (including every line when the network has no source at
 *          all, or a line this BFS never reached) should be treated as NOT
 *          reversed — i.e. draw order — by the caller.
 */
export function computeLineOrientations(network, linesById, options = {}) {
  const result = new Map();
  if (!network || !linesById) return result;
  if (UTILITY_TYPES[network.utilityType]?.directional === false) return result;
  const lineIds = network.lineIds || [];
  if (lineIds.length === 0) return result;

  const lines = [];
  for (const id of lineIds) {
    const l = typeof linesById.get === 'function' ? linesById.get(id) : linesById[id];
    if (l) lines.push(l);
  }
  if (lines.length === 0) return result;

  const sourceKeys = new Set((network.sources || []).map(s => s.portKey));
  if (sourceKeys.size === 0) return result; // nothing delivering here — draw order, no crash

  // ---- adjacency: lineId -> [{ otherId, otherEnd }] ------------------------
  // otherEnd is 'start' | 'end' | 'interior' — the classification of the
  // OTHER line's touch point. 'interior' only ever appears when that line is
  // touched mid-span (a tap onto its body, not either of its own ends), and
  // is deliberately never used to SET a line's own orientation (see the BFS
  // loop below) — only 'start'/'end' matches, which every line's OWN two
  // ends always are, ever assign a direction.
  const adjacency = new Map();
  function addEdge(idA, endA, idB, endB) {
    if (idA === idB) return;
    if (!adjacency.has(idA)) adjacency.set(idA, []);
    if (!adjacency.has(idB)) adjacency.set(idB, []);
    adjacency.get(idA).push({ otherId: idB, otherEnd: endB });
    adjacency.get(idB).push({ otherId: idA, otherEnd: endA });
  }

  // Port matches: which lines' start/end sit on each port key.
  const byPortKey = new Map();
  for (const l of lines) {
    for (const end of ['start', 'end']) {
      const ref = l[end];
      if (!ref) continue;
      const k = portKeyOf(ref);
      if (!byPortKey.has(k)) byPortKey.set(k, []);
      byPortKey.get(k).push({ lineId: l.id, end });
    }
  }
  for (const hits of byPortKey.values()) {
    for (let a = 0; a < hits.length; a++) {
      for (let b = a + 1; b < hits.length; b++) {
        addEdge(hits[a].lineId, hits[a].end, hits[b].lineId, hits[b].end);
      }
    }
  }

  // Multi-port device continuity: union every line touching ANY pass-through
  // (or ANY source) port of the same placeable, exactly as network-discovery
  // does at the network level, so a line landing on outlet A and another on
  // outlet B of the same panel are treated as touching one point.
  const portsByPlaceable = new Map();
  for (const p of (network.ports || [])) {
    if (!portsByPlaceable.has(p.placeableId)) portsByPlaceable.set(p.placeableId, []);
    portsByPlaceable.get(p.placeableId).push(p);
  }
  for (const ports of portsByPlaceable.values()) {
    for (const role of ['pass', 'source']) {
      const roleKeys = ports.filter(p => p.role === role).map(p => `${p.placeableId}:${p.portName}`);
      if (roleKeys.length < 2) continue;
      const hits = [];
      for (const k of roleKeys) for (const hit of (byPortKey.get(k) || [])) hits.push(hit);
      for (let a = 0; a < hits.length; a++) {
        for (let b = a + 1; b < hits.length; b++) {
          addEdge(hits[a].lineId, hits[a].end, hits[b].lineId, hits[b].end);
        }
      }
    }
  }

  // Spatial taps, INCLUDING mid-span (a line's terminal landing on another
  // line's interior — the common "branch off a header" case). Every
  // expanded point of every line goes into the bucket, tagged terminal vs
  // interior; two DIFFERENT lines sharing a subtile join only when at least
  // one side is terminal there — same rule network-discovery.js applies so a
  // "join" here never disagrees with what actually put these lines in one
  // network.
  if (UTILITY_TYPES[network.utilityType]?.allowsTap === true) {
    const joinsOnContact = UTILITY_TYPES[network.utilityType]?.joinsOnContact === true;
    const subtileToLines = new Map();
    for (const l of lines) {
      const expanded = expandPath(l.path || []);
      for (let i = 0; i < expanded.length; i++) {
        const key = subtileKey(expanded[i]);
        const end = i === 0 ? 'start' : (i === expanded.length - 1 ? 'end' : 'interior');
        if (!subtileToLines.has(key)) subtileToLines.set(key, []);
        subtileToLines.get(key).push({ lineId: l.id, end });
      }
    }
    for (const hits of subtileToLines.values()) {
      if (hits.length < 2) continue;
      for (let a = 0; a < hits.length; a++) {
        for (let b = a + 1; b < hits.length; b++) {
          if (hits[a].lineId === hits[b].lineId) continue;
          if (!joinsOnContact
              && hits[a].end === 'interior' && hits[b].end === 'interior') continue;
          addEdge(hits[a].lineId, hits[a].end, hits[b].lineId, hits[b].end);
        }
      }
    }
  }

  // ---- multi-source BFS ----------------------------------------------------
  // Every line directly touching a source port is a seed, all at hop 0 —
  // standard multi-source BFS, so a line between two sources naturally
  // orients off whichever it reaches first (requirement: "orient from the
  // nearest source, don't try to be clever about merging").
  const visited = new Map(); // lineId -> the end nearest the source ('start'|'end')
  const queue = [];
  for (const l of lines) {
    const startIsSource = l.start && sourceKeys.has(portKeyOf(l.start));
    const endIsSource = l.end && sourceKeys.has(portKeyOf(l.end));
    if (startIsSource) { visited.set(l.id, 'start'); queue.push(l.id); }
    else if (endIsSource) { visited.set(l.id, 'end'); queue.push(l.id); }
  }
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    for (const edge of (adjacency.get(id) || [])) {
      if (visited.has(edge.otherId)) continue;
      // An 'interior' tag means THIS line only touches the other line's
      // body, not either of its declared ends — not enough information to
      // assign a direction. It still resolves normally via its OWN ends
      // (ports, or being someone else's 'start'/'end' touch) if reachable
      // any other way; if not, it's a rare topology (see module doc) and
      // falls back to draw order rather than guessing.
      if (edge.otherEnd === 'interior') continue;
      visited.set(edge.otherId, edge.otherEnd);
      queue.push(edge.otherId);
    }
  }

  // 'start' nearest the source -> forward (not reversed). 'end' nearest the
  // source -> reversed, so baked distance-from-source still increases from
  // whichever end bakeRunDistanceUVs/bakeRunDistanceFromPositionZ treats as
  // runDist.start.
  const invert = options.invertDirection === true;
  for (const [lineId, nearestEnd] of visited) {
    result.set(lineId, (nearestEnd === 'end') !== invert);
  }
  return result;
}
