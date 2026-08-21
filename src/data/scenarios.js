// Scenario definitions — selectable from the New Game picker.
// Each scenario has metadata for the picker UI and a generator function
// that returns the map data (floors, zones, walls, doors, placeables).
// An optional setup(game) runs AFTER game.applyScenario(mapData): it builds
// dynamic content (beamlines, pipes, utility lines) through the normal Game
// APIs so scripted layouts satisfy utility gating. test/test-scenarios.js
// regression-checks that every scenario boots with zero hard infra blockers.

import { generateRealLab, setupRealLab } from './scenarios/realLab.js';
import { generateSmallBeamlineFacility, setupSmallBeamlineFacility } from './scenarios/smallBeamlineFacility.js';

// Browser-local scenario catalogue: the dev-only Scenario Editor publishes
// complete playable starting situations here without requiring a source-code
// edit. The index stays small while each (potentially large) map payload gets
// its own localStorage entry.
//
// CUSTOM_SCENARIO_KEY / CUSTOM_SCENARIO_ID are retained only to migrate and
// resolve layouts saved by the old single-slot implementation.
export const CUSTOM_SCENARIO_KEY = 'beamlineTycoon.customScenario';
export const CUSTOM_SCENARIO_ID = '__custom__';
export const CUSTOM_SCENARIO_INDEX_KEY = 'beamlineTycoon.customScenarioIndex';
export const CUSTOM_SCENARIO_PREFIX = 'beamlineTycoon.customScenarios.';
// Exported for storage migration compatibility; New Game no longer reads it.
export const DEFAULT_STARTING_SCENARIO_KEY = 'beamlineTycoon.defaultStartingScenario';
export const PENDING_SCENARIO_KEY = 'beamlineTycoon.pendingScenario';

function parseStoredScenario(raw) {
  try {
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || !obj.data) return null;
    return obj;
  } catch (_) { return null; }
}

function readCustomScenarioIndex(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(CUSTOM_SCENARIO_INDEX_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(entry => entry?.id) : [];
  } catch (_) { return []; }
}

function writeCustomScenarioIndex(storage, index) {
  storage.setItem(CUSTOM_SCENARIO_INDEX_KEY, JSON.stringify(index));
}

function customScenarioStorageKey(id) {
  return CUSTOM_SCENARIO_PREFIX + encodeURIComponent(id);
}

/** Stable picker/launch id for a browser-local scenario. */
export function customScenarioRef(id) {
  return `${CUSTOM_SCENARIO_ID}:${encodeURIComponent(id)}`;
}

export function customScenarioIdFromRef(ref) {
  const prefix = `${CUSTOM_SCENARIO_ID}:`;
  if (typeof ref !== 'string' || !ref.startsWith(prefix)) return null;
  try { return decodeURIComponent(ref.slice(prefix.length)); }
  catch (_) { return null; }
}

function migrateLegacyCustomScenario(storage) {
  if (!storage) return;
  let legacy = null;
  try { legacy = parseStoredScenario(storage.getItem(CUSTOM_SCENARIO_KEY)); }
  catch (_) { return; }
  if (!legacy) {
    storage.removeItem(DEFAULT_STARTING_SCENARIO_KEY);
    return;
  }

  const id = String(legacy.id || 'customScenario');
  const index = readCustomScenarioIndex(storage);
  const existing = index.find(entry => entry.id === id);
  const existingPayload = parseStoredScenario(storage.getItem(customScenarioStorageKey(id)));
  if (!existing || !existingPayload) {
    const stored = {
      id,
      name: legacy.name || 'Custom Scenario',
      desc: legacy.desc || '',
      data: legacy.data,
      sandbox: legacy.sandbox !== false,
      updatedAt: legacy.updatedAt || Date.now(),
    };
    storage.setItem(customScenarioStorageKey(id), JSON.stringify(stored));
    const metadata = {
      id: stored.id,
      name: stored.name,
      desc: stored.desc,
      sandbox: stored.sandbox,
      updatedAt: stored.updatedAt,
    };
    if (existing) Object.assign(existing, metadata);
    else index.push(metadata);
    writeCustomScenarioIndex(storage, index);
  }
  storage.removeItem(CUSTOM_SCENARIO_KEY);
  storage.removeItem(DEFAULT_STARTING_SCENARIO_KEY);
}

/** Return every valid browser-local playable scenario, newest first. */
export function listCustomScenarios(storage = globalThis.localStorage) {
  try { migrateLegacyCustomScenario(storage); }
  catch (_) { /* A read should still degrade to an empty catalogue. */ }
  return readCustomScenarioIndex(storage)
    .map(entry => parseStoredScenario(storage?.getItem(customScenarioStorageKey(entry.id))))
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** Compatibility helper: return the newest local scenario, if one exists. */
export function loadCustomScenario(storage = globalThis.localStorage) {
  return listCustomScenarios(storage)[0] || null;
}

export function loadCustomScenarioById(id, storage = globalThis.localStorage) {
  if (!id) return null;
  try {
    migrateLegacyCustomScenario(storage);
    return parseStoredScenario(storage?.getItem(customScenarioStorageKey(id)));
  } catch (_) { return null; }
}

/**
 * Publish one editor-authored starting situation to the local playable
 * catalogue. Saving the same id overwrites that scenario; a new id creates a
 * second picker entry. Sandbox behavior belongs to the scenario payload.
 */
export function saveCustomScenario(payload, {
  storage = globalThis.localStorage,
} = {}) {
  if (!storage || !payload?.data) throw new Error('Scenario data is required');
  if (!payload.id) throw new Error('Scenario id is required');
  const stored = {
    id: String(payload.id),
    name: payload.name || 'Custom Scenario',
    desc: payload.desc || '',
    data: payload.data,
    sandbox: payload.sandbox !== false,
    updatedAt: Date.now(),
  };
  storage.setItem(customScenarioStorageKey(stored.id), JSON.stringify(stored));

  const index = readCustomScenarioIndex(storage);
  const existing = index.find(entry => entry.id === stored.id);
  const metadata = {
    id: stored.id,
    name: stored.name,
    desc: stored.desc,
    sandbox: stored.sandbox,
    updatedAt: stored.updatedAt,
  };
  if (existing) Object.assign(existing, metadata);
  else index.push(metadata);
  writeCustomScenarioIndex(storage, index);
  return stored;
}

// Resolve a scenario id (registry id or a browser-local reference) to a
// { id, name, generator } shape usable by the boot path and picker.
export function resolveScenario(id, storage = globalThis.localStorage) {
  const localId = customScenarioIdFromRef(id);
  if (localId != null || id === CUSTOM_SCENARIO_ID) {
    const custom = localId != null
      ? loadCustomScenarioById(localId, storage)
      : loadCustomScenario(storage);
    if (!custom) return null;
    return {
      id: customScenarioRef(custom.id),
      localId: custom.id,
      name: custom.name || 'Custom Scenario',
      desc: custom.desc || 'A locally created starting situation.',
      difficulty: custom.sandbox === true ? 'Custom · Sandbox' : 'Custom',
      generator: () => custom.data,
      sandbox: custom.sandbox === true,
      local: true,
    };
  }
  return SCENARIOS.find(s => s.id === id) || null;
}

/** All scenarios shown by New Game, with local creations first. */
export function listPlayableScenarios(storage = globalThis.localStorage) {
  const local = listCustomScenarios(storage)
    .map(scenario => resolveScenario(customScenarioRef(scenario.id), storage))
    .filter(Boolean);
  return [...local, ...SCENARIOS];
}

/** Stage a picker selection for the existing post-reload scenario boot path. */
export function stageScenarioSelection(id, storage = globalThis.localStorage) {
  const scenario = resolveScenario(id, storage);
  if (!scenario) return null;
  if (scenario.generator) storage?.setItem(PENDING_SCENARIO_KEY, scenario.id);
  else storage?.removeItem(PENDING_SCENARIO_KEY);
  return scenario;
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
