// Scenario definitions — selectable from the Scenarios menu.
// Each scenario has metadata for the picker UI and a generator function
// that returns the map data (floors, zones, walls, doors, placeables).
// An optional setup(game) runs AFTER game.applyScenario(mapData): it builds
// dynamic content (beamlines, pipes, utility lines) through the normal Game
// APIs so scripted layouts satisfy utility gating. test/test-scenarios.js
// regression-checks that every scenario boots with zero hard infra blockers.

import { generateRealLab, setupRealLab } from './scenarios/realLab.js';
import { generateSmallBeamlineFacility, setupSmallBeamlineFacility } from './scenarios/smallBeamlineFacility.js';

// Custom-scenario slot: the in-game Scenario Editor (dev-only) exports the
// built world here so it can be play-tested without editing source files.
// Slot payload: { id, name, data } where data is the scenario map shape
// (floors, zones, walls, doors, placeables, beamPipes, utilityLines, ...).
export const CUSTOM_SCENARIO_KEY = 'beamlineTycoon.customScenario';
export const CUSTOM_SCENARIO_ID = '__custom__';
export const DEFAULT_STARTING_SCENARIO_KEY = 'beamlineTycoon.defaultStartingScenario';
export const PENDING_SCENARIO_KEY = 'beamlineTycoon.pendingScenario';

export function loadCustomScenario(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(CUSTOM_SCENARIO_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || !obj.data) return null;
    return obj;
  } catch (_) { return null; }
}

/**
 * Persist the dev-authored scenario and optionally make it the layout used by
 * New Game. The payload keeps the sandbox flag with the scenario instead of
 * relying on whichever global Options setting happened to be active while it
 * was authored.
 */
export function saveCustomScenario(payload, {
  storage = globalThis.localStorage,
  makeDefault = true,
} = {}) {
  if (!storage || !payload?.data) throw new Error('Scenario data is required');
  const stored = {
    id: payload.id || 'customScenario',
    name: payload.name || 'Custom Scenario',
    data: payload.data,
    sandbox: payload.sandbox !== false,
  };
  storage.setItem(CUSTOM_SCENARIO_KEY, JSON.stringify(stored));
  if (makeDefault) storage.setItem(DEFAULT_STARTING_SCENARIO_KEY, CUSTOM_SCENARIO_ID);
  return stored;
}

// Resolve a scenario id (registry id or the custom slot) to a
// { id, name, generator } shape usable by the boot path and picker.
export function resolveScenario(id, storage = globalThis.localStorage) {
  if (id === CUSTOM_SCENARIO_ID) {
    const custom = loadCustomScenario(storage);
    if (!custom) return null;
    return {
      id: CUSTOM_SCENARIO_ID,
      name: custom.name || 'Custom Scenario',
      generator: () => custom.data,
      sandbox: custom.sandbox === true,
    };
  }
  return SCENARIOS.find(s => s.id === id) || null;
}

/** Return a valid locally configured New Game scenario, or null. */
export function loadDefaultStartingScenarioId(storage = globalThis.localStorage) {
  try {
    const id = storage?.getItem(DEFAULT_STARTING_SCENARIO_KEY);
    return id && resolveScenario(id, storage) ? id : null;
  } catch (_) { return null; }
}

/**
 * Stage the local default for the normal pending-scenario boot path. Keeping
 * this decision here makes title-screen and in-game New Game behave alike.
 */
export function stageDefaultStartingScenario(storage = globalThis.localStorage) {
  const id = loadDefaultStartingScenarioId(storage);
  if (id) storage?.setItem(PENDING_SCENARIO_KEY, id);
  else storage?.removeItem(PENDING_SCENARIO_KEY);
  return id;
}

export const SCENARIOS = [
  {
    id: 'sandbox',
    name: 'Sandbox',
    desc: 'Start from scratch with an empty plot and $2.5M. Full freedom to design your facility from the ground up.',
    difficulty: 'Open',
    generator: null,  // null = default blank game
  },
  {
    id: 'realLab',
    name: 'Real Lab — Central Hallway',
    desc: 'Inspired by SLAC/NASA SPL double-loaded hallway: test cells north, offices south, 12m central hallway spine with doors and furnished labs/control/cafeteria. Based on 78×19 ft hallway separating labs from offices.',
    difficulty: 'Realistic',
    generator: generateRealLab,
    setup: setupRealLab,
  },
  {
    id: 'smallBeamlineFacility',
    name: 'Small Beamline Facility',
    desc: 'Compact realistic national-lab style: 18×10 m building with shielded beam hall (14×3), central hallway, RF/vacuum labs north, control/cafeteria south. Beamline runs inside the hall, not on grass. Flat terrain, furnished.',
    difficulty: 'Realistic',
    generator: generateSmallBeamlineFacility,
    setup: setupSmallBeamlineFacility,
  },
];
