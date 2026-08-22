// Exact staff-navigation openings for edge-mounted doors.
//
// Room flood-fill only needs to know whether an edge has any door. Staff move
// at subtile resolution, so they need the stronger answer: whether the exact
// half-metre lane they are crossing lies inside that door's authored opening.

import { DOOR_TYPES } from '../../data/structure.js';
import {
  canonicalEdge, clampDoorOff, doorRecordEdges, doorSubWidth, edgeKey, mirrorDoorOff,
  parseEdgeKey,
} from '../edge-keys.js';
import { levelOf } from '../storeys.js';

const SLOT_SEPARATOR = '@';

function canonicalSiteAndSlot(col, row, edge, slot, level = 0) {
  const site = canonicalEdge(col, row, edge);
  if (!site || !Number.isInteger(slot) || slot < 0 || slot > 3) return null;
  // subCol/subRow already increase with the world axis from either side of
  // an edge. Only authored door offsets reverse for s/w; crossing slots do
  // not.
  const canonicalSlot = slot;
  return {
    site,
    slot: canonicalSlot,
    crossingKey: `${edgeKey(site.col, site.row, site.edge, level)}${SLOT_SEPARATOR}${canonicalSlot}`,
  };
}

/** Stable physical edge key used by both navigation and door presentation. */
export function canonicalDoorEdgeKey(col, row, edge, level = 0) {
  const site = canonicalEdge(col, row, edge);
  return site ? edgeKey(site.col, site.row, site.edge, level) : null;
}

/** The exact physical edge lane crossed by a tile-boundary staff step. */
export function staffCrossingKey(node, edge) {
  const slot = (edge === 'n' || edge === 's') ? node.subCol : node.subRow;
  return canonicalSiteAndSlot(node.col, node.row, edge, slot, levelOf(node))?.crossingKey || null;
}

/**
 * Map every open edge lane to its owning door's stable key. A wide door maps
 * all of its segment lanes to one owner key so traversing any segment opens
 * the complete rendered assembly.
 */
export function buildDoorCrossingIndex(state) {
  const index = new Map();
  // Real Game states carry full records in `doors`. Minimal test/scenario
  // fixtures historically supplied only doorOccupied; retain that seam by
  // synthesizing single records when the authoritative array is absent.
  const records = (state.doors || []).length
    ? state.doors
    : Object.entries(state.doorOccupied || {}).map(([key, type]) => {
      const site = parseEdgeKey(key);
      return site ? { ...site, type } : null;
    }).filter(Boolean);
  for (const record of records) {
    const def = DOOR_TYPES[record.type];
    if (!def) continue;
    const segments = doorRecordEdges(record, def);
    if (!segments.length) continue;
    const level = levelOf(record);
    const owner = canonicalDoorEdgeKey(
      segments[0].col, segments[0].row, segments[0].edge, level,
    );
    const width = doorSubWidth(def);
    for (const segment of segments) {
      const authoredOff = clampDoorOff(def, record.off);
      const off = (segment.edge === 's' || segment.edge === 'w')
        ? mirrorDoorOff(authoredOff, def)
        : authoredOff;
      for (let slot = off; slot < off + width; slot++) {
        const crossing = canonicalSiteAndSlot(
          segment.col, segment.row, segment.edge, slot, level,
        );
        if (crossing) index.set(crossing.crossingKey, owner);
      }
    }
  }
  return index;
}
