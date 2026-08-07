// Scenario definitions — selectable from the Scenarios menu.
// Each scenario has metadata for the picker UI and a generator function
// that returns the map data (floors, zones, walls, doors, placeables).

import { generateRealLab } from './scenarios/realLab.js';
import { generateSmallBeamlineFacility } from './scenarios/smallBeamlineFacility.js';

export const SCENARIOS = [
  {
    id: 'sandbox',
    name: 'Sandbox',
    desc: 'Start from scratch with an empty plot and $10M. Full freedom to design your facility from the ground up.',
    difficulty: 'Open',
    generator: null,  // null = default blank game
  },
  {
    id: 'realLab',
    name: 'Real Lab — Central Hallway',
    desc: 'Inspired by SLAC/NASA SPL double-loaded hallway: test cells north, offices south, 12m central hallway spine with doors and furnished labs/control/cafeteria. Based on 78×19 ft hallway separating labs from offices.',
    difficulty: 'Realistic',
    generator: generateRealLab,
  },
  {
    id: 'smallBeamlineFacility',
    name: 'Small Beamline Facility',
    desc: 'Compact realistic national-lab style: 18×10 m building with shielded beam hall (14×3), central hallway, RF/vacuum labs north, control/cafeteria south. Beamline runs inside the hall, not on grass. Flat terrain, furnished.',
    difficulty: 'Realistic',
    generator: generateSmallBeamlineFacility,
  },
];
