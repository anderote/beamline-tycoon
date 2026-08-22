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
  privateOffice: { id: 'privateOffice', name: 'Private Office', color: 0x665588, requiredFloor: 'officeFloor', gatesCategory: null, subsection: 'operations' },
  controlRoom: { id: 'controlRoom', name: 'Control Room',   color: 0x44aa66, requiredFloor: 'officeFloor', gatesCategory: 'dataControls', subsection: 'operations'   },
  // gatesCategory is matched against a component's `category`, i.e. a palette
  // tab id — not a mode id. The machine shop gates every beamline tab, so it
  // takes the array form (hud.js already handles both).
  machineShop: { id: 'machineShop', name: 'Machine Shop',   color: 0x886655, requiredFloor: 'labFloor',    gatesCategory: ['source', 'optics', 'rf', 'diagnostic', 'endpoint'], subsection: 'industrial'   },
  maintenance: { id: 'maintenance', name: 'Maintenance',    color: 0xaa6633, requiredFloor: 'concrete',    gatesCategory: 'ops',          subsection: 'industrial'   },
  opticsLab:   { id: 'opticsLab',   name: 'Optics Lab',     color: 0x44aacc, requiredFloor: 'labFloor',    gatesCategory: null,           subsection: 'laboratories' },
  diagnosticsLab: { id: 'diagnosticsLab', name: 'Diagnostics Lab', color: 0xaacc44, requiredFloor: 'labFloor', gatesCategory: null,      subsection: 'laboratories' },
  cafeteria:   { id: 'cafeteria',   name: 'Cafeteria',      color: 0xaa6644, requiredFloor: 'officeFloor', gatesCategory: null,           subsection: 'operations'   },
  kitchen:     { id: 'kitchen',     name: 'Kitchen',        color: 0xc47b3d, requiredFloor: 'officeFloor', gatesCategory: null,           subsection: 'operations'   },
  meetingRoom: { id: 'meetingRoom', name: 'Meeting Room',   color: 0x664499, requiredFloor: 'officeFloor', gatesCategory: null,           subsection: 'operations'   },
  facultyLounge: { id: 'facultyLounge', name: 'Faculty Lounge', color: 0x886655, requiredFloor: 'officeFloor', gatesCategory: null, subsection: 'operations' },
  reception:   { id: 'reception',   name: 'Reception',      color: 0xbb8855, requiredFloor: 'officeFloor', gatesCategory: null,           subsection: 'operations'   },
  storageRoom: { id: 'storageRoom', name: 'Storage Room',   color: 0x668877, requiredFloor: 'concrete',    gatesCategory: null,           subsection: 'industrial'   },
};

// Palette-preview descriptions, kept in one block so the zone table above
// stays scannable. Shown in the HUD preview panel on hover/keyboard focus.
const ZONE_DESCS = {
  rfLab: 'Where RF hardware gets tested, tuned, and occasionally arcs. Paint over Lab Flooring; growth unlocks RF Power tiers.',
  coolingLab: 'Water and cryo test space — bring a jacket. Paint over Lab Flooring; growth unlocks Cooling tiers.',
  vacuumLab: 'Leak-checking and bake-out country. Paint over Lab Flooring; growth unlocks Vacuum tiers.',
  officeSpace: 'Where grad students photosynthesize under fluorescent light. Paint over Office Flooring.',
  privateOffice: 'Quiet rooms for directors, senior scientists, and anyone whose calendar has become a weapon. Paint over Office Flooring.',
  controlRoom: 'Mission control for the machine. Paint over Office Flooring; growth unlocks Data & Controls tiers.',
  machineShop: 'Chips fly, parts appear. Paint over Lab Flooring; growth unlocks Beamline component tiers.',
  maintenance: 'Staging for carts, crates, and things that "worked yesterday". Paint over bare Concrete; growth unlocks Ops tiers.',
  opticsLab: 'Dim lights, clean optics, no touching the mirror face. Paint over Lab Flooring.',
  diagnosticsLab: 'Where signals become plots and plots become papers. Paint over Lab Flooring.',
  cafeteria: 'Feeds the facility, fuels the physics. Paint over Office Flooring.',
  kitchen: 'Prepares meals and keeps the cafeteria supplied. Paint over Office Flooring.',
  meetingRoom: 'This meeting could have been an email. Paint over Office Flooring.',
  facultyLounge: 'Leather chairs, old journals, and a bar for the people who approve the beamtime. Paint over Office Flooring.',
  reception: 'The public face of the facility. Paint over Office Flooring.',
  storageRoom: 'Organized supplies, spares, and shipping overflow. Paint over bare Concrete.',
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

// Resolve the preferred zone that contains an item's complete footprint.
// Placement and core equipment behavior do not use this helper: zones are a
// bonus layer. Research/zone-output bonuses do use it so straddling a room
// boundary cannot activate an item that is only partly inside its bonus zone.
export function matchingZoneForPlacement(def, placed, zoneOccupied, keyForCell = null) {
  if (!def || !placed || !zoneOccupied) return null;
  const tiles = new Set();
  const cells = Array.isArray(placed.cells) && placed.cells.length
    ? placed.cells : [{ col: placed.col, row: placed.row }];
  for (const cell of cells) {
    if (cell?.col == null || cell?.row == null) return null;
    tiles.add(keyForCell ? keyForCell(cell, placed) : `${cell.col},${cell.row}`);
  }

  let matched = null;
  for (const key of tiles) {
    const zoneType = zoneOccupied[key];
    if (!itemMatchesZone(def, zoneType)) return null;
    if (matched !== null && matched !== zoneType) return null;
    matched = zoneType;
  }
  return matched;
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
// the SAME four tile-count thresholds, normalised into [0, 1].
//
// Fix round 1 (coordinator review): normalising by dividing straight by the
// largest threshold (20) made the TOP tier's own required value (20/20 =
// 1.0) exactly equal staffedOutput's own clamp ceiling — reaching tier 4 at
// all necessarily meant sitting AT that clamp with zero headroom above it,
// so a single idle tick (not a lunch break — one tick walking to the door)
// immediately decayed back below 1.0 and dropped the tier. Normalising
// against a value ABOVE the top threshold instead (25 = 20 x 1.25) gives
// tier 4 the same real headroom every other tier already had: it now needs
// staffedOutput >= 0.8, with the clamp still at 1.0, i.e. up to 0.2 of
// margin against the 0.001/tick decay — 200 idle ticks, not 1, before it's
// actually at risk.
const STAFFED_OUTPUT_HEADROOM = 1.25;

export function zoneTierFromStaffedOutput(staffedOutput) {
  const max = ZONE_TIER_THRESHOLDS[ZONE_TIER_THRESHOLDS.length - 1] * STAFFED_OUTPUT_HEADROOM;
  let tier = 0;
  for (let t = ZONE_TIER_THRESHOLDS.length - 1; t >= 0; t--) {
    if (staffedOutput >= ZONE_TIER_THRESHOLDS[t] / max) { tier = t + 1; break; }
  }
  return tier;
}

// Which zone types the staffing ratchet applies to at all.
//
// Fix round 1 (coordinator review): this USED to be derived from
// ZONE_FURNISHINGS — "any zone type a labWork-capable furnishing can be
// placed in" — on the theory that deriving it from the catalogue beats a
// hand-maintained list that could drift. That reasoning was backwards: a
// bench being PLACEABLE somewhere says nothing about whether an ENGINEER
// can make real progress there, and `labBench`'s own `zoneTypes` array
// includes machineShop and maintenance, which the derivation duly swept
// in. Neither has an engineering specialty (professions.js's
// SPECIALTY_AXES.engineering covers only rf/vacuum/cooling/diagnostics/
// controls -> rfLab/vacuumLab/coolingLab/diagnosticsLab/controlRoom), so
// engineer attention sent there by ordinary assignment (nearest eligible
// station, no specialty-aware routing) is thin and inconsistent enough
// that staffedOutput never reliably clears even tier 1. In a large-facility
// headless benchmark, machineShop's
// own staffedOutput peaked at 0.18, just under the 0.2 tier-1 threshold,
// permanently pinning 12 research nodes (RESEARCH_LAB_MAP's machineShop
// category) at "not yet startable" — 81% of an 80,000-tick run blocked on
// lab tier. Excluding machineShop/maintenance drops that to ~2%.
//
// Hand-listed (not imported from professions.js's SPECIALTY_AXES.engineering
// directly) because professions.js imports ZONES FROM this file — importing
// SPECIALTY_AXES back would be a real module cycle. Keep this in sync with
// that table's own engineering zoneIds by hand.
export const LABWORK_CAPABLE_ZONES = new Set(['rfLab', 'vacuumLab', 'coolingLab', 'diagnosticsLab', 'controlRoom']);
