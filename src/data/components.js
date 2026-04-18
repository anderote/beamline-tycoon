// src/data/components.js
//
// LEGACY SHIM: COMPONENTS was the source of truth before the unified
// PLACEABLES registry. It now re-derives from PLACEABLES so existing
// consumers (mesh builders, beam graph, economy) keep working.
// Do NOT add new entries here. Add them to src/data/placeables/.
//
// Entries that are not modeled as Placeables (drift connector, attachments
// like turbo pumps / gauges that bolt onto vacuum pipes) fall back to the
// raw registries so existing consumers that look up COMPONENTS.drift or
// COMPONENTS[attachmentId] continue to work.

import { PLACEABLES } from './placeables/index.js';
import { BEAMLINE_COMPONENTS_RAW } from './beamline-components.raw.js';
import { INFRASTRUCTURE_RAW } from './infrastructure.raw.js';
import { getUtilityPortsV2 } from './utility-ports-v2.js';

export const COMPONENTS = {};

// Start with raw entries so drift + attachments are present.
for (const [id, raw] of Object.entries(BEAMLINE_COMPONENTS_RAW)) {
  COMPONENTS[id] = raw;
}
for (const [id, raw] of Object.entries(INFRASTRUCTURE_RAW)) {
  COMPONENTS[id] = raw;
}

// Overlay wrapped Placeable instances for placeable kinds.
for (const p of Object.values(PLACEABLES)) {
  if (p.kind === 'beamline' || p.kind === 'infrastructure' || p.kind === 'equipment') {
    COMPONENTS[p.id] = p;
  }
}

// Merge new-schema utility ports into each entry's `ports` object without
// clobbering existing beam-pipe ports (entry, exit, linacEntry, ringExit,
// etc.). Placeables from PLACEABLES share their `ports` object by reference
// with the raw, so we always assign a fresh merged object to `entry.ports`
// to avoid leaking utility ports into the raw registries.
for (const id of Object.keys(COMPONENTS)) {
  const entry = COMPONENTS[id];
  const utilityPorts = getUtilityPortsV2(id);
  if (Object.keys(utilityPorts).length === 0) continue;
  const existing = entry.ports || {};
  const merged = { ...existing };
  for (const [name, spec] of Object.entries(utilityPorts)) {
    // Don't overwrite an existing port of the same name (beam ports win).
    if (!merged[name]) merged[name] = spec;
  }
  if (Object.isFrozen(entry)) {
    COMPONENTS[id] = { ...entry, ports: merged };
  } else {
    entry.ports = merged;
  }
}

// Validate: every beamline/infra raw entry must have a placement type
for (const raws of [BEAMLINE_COMPONENTS_RAW, INFRASTRUCTURE_RAW]) {
  for (const [key, comp] of Object.entries(raws)) {
    if (!comp.placement) {
      console.warn(`Component '${key}' missing placement type`);
    }
    if (comp.placement === 'module' && !comp.ports) {
      console.warn(`Module '${key}' missing ports definition`);
    }
  }
}
