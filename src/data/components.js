// src/data/components.js
//
// LEGACY SHIM: COMPONENTS was the source of truth before the unified
// PLACEABLES registry. It now re-derives from PLACEABLES so existing
// consumers (mesh builders, beam graph, economy) keep working.
// Do NOT add new entries here. Add them to src/data/placeables/.
//
// Entries that are not modeled as Placeables (drift connector, attachments)
// fall back to the raw legacy registry so existing consumers that look up
// COMPONENTS.drift or COMPONENTS[attachmentId] continue to work.

import { PLACEABLES } from './placeables/index.js';
import { COMPONENTS_RAW } from './components.raw.js';

export const COMPONENTS = {};

// Start with raw entries so drift + attachments are present.
for (const [id, raw] of Object.entries(COMPONENTS_RAW)) {
  COMPONENTS[id] = raw;
}

// Overlay wrapped Placeable instances for beamline/equipment kinds.
for (const p of Object.values(PLACEABLES)) {
  if (p.kind === 'beamline' || p.kind === 'equipment') {
    COMPONENTS[p.id] = p;
  }
}
