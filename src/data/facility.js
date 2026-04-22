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
  machineShop: { id: 'machineShop', name: 'Machine Shop',   color: 0x886655, requiredFloor: 'labFloor',    gatesCategory: 'beamline',     subsection: 'industrial'   },
  maintenance: { id: 'maintenance', name: 'Maintenance',    color: 0xaa6633, requiredFloor: 'concrete',    gatesCategory: 'ops',          subsection: 'industrial'   },
  opticsLab:   { id: 'opticsLab',   name: 'Optics Lab',     color: 0x44aacc, requiredFloor: 'labFloor',    gatesCategory: null,           subsection: 'laboratories' },
  diagnosticsLab: { id: 'diagnosticsLab', name: 'Diagnostics Lab', color: 0xaacc44, requiredFloor: 'labFloor', gatesCategory: null,      subsection: 'laboratories' },
  cafeteria:   { id: 'cafeteria',   name: 'Cafeteria',      color: 0xaa6644, requiredFloor: 'officeFloor', gatesCategory: null,           subsection: 'operations'   },
  meetingRoom: { id: 'meetingRoom', name: 'Meeting Room',   color: 0x664499, requiredFloor: 'officeFloor', gatesCategory: null,           subsection: 'operations'   },
};

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
