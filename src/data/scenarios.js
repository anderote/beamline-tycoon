// Scenario definitions — selectable from the Scenarios menu.
// Each scenario has metadata for the picker UI and a generator function
// that returns the map data (floors, zones, walls, doors, placeables).

export const SCENARIOS = [
  {
    id: 'sandbox',
    name: 'Sandbox',
    desc: 'Start from scratch with an empty plot and $10M. Full freedom to design your facility from the ground up.',
    difficulty: 'Open',
    generator: null,  // null = default blank game
  },
];
