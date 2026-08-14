// src/data/facility.js
//
// Facility data — items that appear in the Facility build mode.
// Facility mode lets the player paint zones (lab + room types) over
// floor tiles, then place lab or room furnishings inside them.
//
// Zones live here because they are facility-mode concepts: each zone
// gates which furnishings can be placed and what tier of equipment
// unlocks. Floors that satisfy zone requirements live in structure.js.

import { PLACEABLES } from './placeables/index.js';

export const ZONES = {
  rfLab:       { id: 'rfLab',       name: 'RF Laboratory',  color: 0xaa8833, requiredFloor: 'labFloor',    gatesCategory: 'rfPower',      subsection: 'laboratories' },
  coolingLab:  { id: 'coolingLab',  name: 'Cooling Lab',    color: 0x33aaaa, requiredFloor: 'labFloor',    gatesCategory: 'cooling',      subsection: 'laboratories' },
  vacuumLab:   { id: 'vacuumLab',   name: 'Vacuum Lab',     color: 0x7744aa, requiredFloor: 'labFloor',    gatesCategory: 'vacuum',       subsection: 'laboratories' },
  officeSpace: { id: 'officeSpace', name: 'Office Space',   color: 0x4466aa, requiredFloor: 'officeFloor', gatesCategory: null,           subsection: 'operations'   },
  controlRoom: { id: 'controlRoom', name: 'Control Room',   color: 0x44aa66, requiredFloor: 'officeFloor', gatesCategory: 'dataControls', subsection: 'operations'   },
  // gatesCategory is matched against a component's `category`, i.e. a palette
  // tab id — not a mode id. The machine shop gates every beamline tab, so it
  // takes the array form (hud.js already handles both).
  machineShop: { id: 'machineShop', name: 'Machine Shop',   color: 0x886655, requiredFloor: 'labFloor',    gatesCategory: ['source', 'optics', 'rf', 'diagnostic', 'endpoint'], subsection: 'industrial'   },
  maintenance: { id: 'maintenance', name: 'Maintenance',    color: 0xaa6633, requiredFloor: 'concrete',    gatesCategory: 'ops',          subsection: 'industrial'   },
  opticsLab:   { id: 'opticsLab',   name: 'Optics Lab',     color: 0x44aacc, requiredFloor: 'labFloor',    gatesCategory: null,           subsection: 'laboratories' },
  diagnosticsLab: { id: 'diagnosticsLab', name: 'Diagnostics Lab', color: 0xaacc44, requiredFloor: 'labFloor', gatesCategory: null,      subsection: 'laboratories' },
  cafeteria:   { id: 'cafeteria',   name: 'Cafeteria',      color: 0xaa6644, requiredFloor: 'officeFloor', gatesCategory: null,           subsection: 'operations'   },
  meetingRoom: { id: 'meetingRoom', name: 'Meeting Room',   color: 0x664499, requiredFloor: 'officeFloor', gatesCategory: null,           subsection: 'operations'   },
};

// Palette-preview descriptions, kept in one block so the zone table above
// stays scannable. Shown in the HUD preview panel on hover/keyboard focus.
const ZONE_DESCS = {
  rfLab: 'Where RF hardware gets tested, tuned, and occasionally arcs. Paint over Lab Flooring; growth unlocks RF Power tiers.',
  coolingLab: 'Water and cryo test space — bring a jacket. Paint over Lab Flooring; growth unlocks Cooling tiers.',
  vacuumLab: 'Leak-checking and bake-out country. Paint over Lab Flooring; growth unlocks Vacuum tiers.',
  officeSpace: 'Where grad students photosynthesize under fluorescent light. Paint over Office Flooring.',
  controlRoom: 'Mission control for the machine. Paint over Office Flooring; growth unlocks Data & Controls tiers.',
  machineShop: 'Chips fly, parts appear. Paint over Lab Flooring; growth unlocks Beamline component tiers.',
  maintenance: 'Staging for carts, crates, and things that "worked yesterday". Paint over bare Concrete; growth unlocks Ops tiers.',
  opticsLab: 'Dim lights, clean optics, no touching the mirror face. Paint over Lab Flooring.',
  diagnosticsLab: 'Where signals become plots and plots become papers. Paint over Lab Flooring.',
  cafeteria: 'Feeds the facility, fuels the physics. Paint over Office Flooring.',
  meetingRoom: 'This meeting could have been an email. Paint over Office Flooring.',
};
for (const [id, desc] of Object.entries(ZONE_DESCS)) {
  if (ZONES[id]) ZONES[id].desc = desc;
}

export const ZONE_TIER_THRESHOLDS = [4, 8, 16, 20]; // Tier 1: 4 tiles, Tier 2: 8, Tier 3: 16, Tier 4: 20
export const FURNISHING_TIER_THRESHOLDS = [1, 3, 5]; // Tier 1: 1-2, Tier 2: 3-4, Tier 3: 5+

// Legacy lookup map. Every entry from the lab + room raw files is
// wrapped as a Placeable with kind 'furnishing' (room zones) or
// 'equipment' (lab zones). Legacy consumers look things up by id
// regardless of taxonomy, so both kinds are exposed here.
export const ZONE_FURNISHINGS = {};
for (const p of Object.values(PLACEABLES)) {
  if (p.kind === 'furnishing' || p.kind === 'equipment') {
    ZONE_FURNISHINGS[p.id] = p;
  }
}

// True if a furnishing/equipment def is valid in the given zone type.
// Supports legacy scalar `zoneType` and new array `zoneTypes` — a def
// with both would match if either includes the target zone, though the
// project convention is to use one or the other.
export function itemMatchesZone(def, zoneType) {
  if (!def || !zoneType) return false;
  if (def.zoneType === zoneType) return true;
  if (Array.isArray(def.zoneTypes) && def.zoneTypes.includes(zoneType)) return true;
  return false;
}

// --- Zone-tier ratchet (staff-professions-3, jobs-and-gates, task 6) ------
//
// Zone tier used to be a pure function of tile count. It is now
// `min(tierFromTiles, tierFromStaffedOutput)` — see Game.recomputeZoneConnectivity
// and jobRunner.js's own per-tick zone update — so a lab a player painted
// big can still sit at tier 0 until an engineer actually staffs it.
//
// zoneTierFromStaffedOutput maps a zone's `staffedOutput` (a float in
// [0, 1], accumulated by worked labWork ticks — see jobRunner.js) through
// the SAME four tile-count thresholds, normalised into [0, 1] by dividing
// by the largest one. A fully-staffed zone (staffedOutput === 1) always
// reaches the top tier this way, independent of ZONE_TIER_THRESHOLDS'
// absolute numbers.
export function zoneTierFromStaffedOutput(staffedOutput) {
  const max = ZONE_TIER_THRESHOLDS[ZONE_TIER_THRESHOLDS.length - 1];
  let tier = 0;
  for (let t = ZONE_TIER_THRESHOLDS.length - 1; t >= 0; t--) {
    if (staffedOutput >= ZONE_TIER_THRESHOLDS[t] / max) { tier = t + 1; break; }
  }
  return tier;
}

// Which zone types can ever host a labWork bench at all, derived from
// ZONE_FURNISHINGS itself (not a hand-maintained list, which could drift
// silently from the catalogue) via the same itemMatchesZone match research.js's
// own _getFurnishingTier uses. A zone type absent from this set — cafeteria,
// meetingRoom, officeSpace, controlRoom: no lab bench belongs in any of them
// — can never accrue staffedOutput, so the ratchet above would otherwise
// permanently pin its tier to 0. recomputeZoneConnectivity treats a zone
// outside this set as "not staffing-gated at all" (tier = tierFromTiles,
// same as before this task), the same "absent = not applicable" rule
// physics-payload.js's own header already uses for a utility a component
// never declared a sink for.
export const LABWORK_CAPABLE_ZONES = new Set(
  Object.keys(ZONES).filter(zoneType => Object.values(ZONE_FURNISHINGS).some(
    def => def.station?.jobs?.includes('labWork') && itemMatchesZone(def, zoneType),
  )),
);
