// Scenario definitions and regression fixtures. New Game offers browser-local
// Scenario Editor creations, the editable stock Minor Lab, and blank Sandbox;
// the older source-authored facilities remain headless fixtures for utility,
// physics, and economy regression coverage.
// Each scenario has metadata for the picker UI and a generator function
// that returns the map data (floors, zones, walls, doors, placeables).
// An optional setup(game) runs AFTER game.applyScenario(mapData): it builds
// dynamic content (beamlines, pipes, utility lines) through the normal Game
// APIs so scripted layouts satisfy utility gating. test/test-scenarios.js
// regression-checks that every scenario boots with zero hard infra blockers.

import { generateRealLab, setupRealLab } from './scenarios/realLab.js';
import { generateSmallBeamlineFacility, setupSmallBeamlineFacility } from './scenarios/smallBeamlineFacility.js';
import { generateMinorLab, setupMinorLab } from './scenarios/minorLab.js';

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
export const MINOR_LAB_SCENARIO_ID = 'minorLab';
export const MINOR_LAB_BASELINE_VERSION = '2026-08-22-minorLab-19';
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

function parseCustomScenarioIndex(raw, { strict = false } = {}) {
  try {
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) throw new Error('Scenario catalogue index is not an array');
    if (strict && parsed.some(entry => !entry || typeof entry !== 'object' || !entry.id)) {
      throw new Error('Scenario catalogue index contains an invalid entry');
    }
    return parsed.filter(entry => entry?.id);
  } catch (error) {
    if (strict) throw error;
    return [];
  }
}

function readCustomScenarioIndex(storage, options) {
  try {
    return parseCustomScenarioIndex(storage?.getItem(CUSTOM_SCENARIO_INDEX_KEY), options);
  } catch (error) {
    if (options?.strict) throw error;
    return [];
  }
}

function writeCustomScenarioIndex(storage, index) {
  storage.setItem(CUSTOM_SCENARIO_INDEX_KEY, JSON.stringify(index));
}

function customScenarioStorageKey(id) {
  return CUSTOM_SCENARIO_PREFIX + encodeURIComponent(id);
}

function isMinorLabIdentifier(value) {
  // Historical Save As flows produced variants such as minorLab2,
  // "Minor Lab 4", and "Minor Lab Copy". Treat all of them as revisions of
  // the one canonical starter instead of separate scenarios.
  const compact = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return /^minorlab(?:copy)?\d*$/.test(compact);
}

function isMinorLabEntry(entry) {
  return isMinorLabIdentifier(entry?.id) || isMinorLabIdentifier(entry?.name);
}

/**
 * Remove legacy Scenario Admin revisions named "Minor Lab" and retain at most
 * the one stable local override created against the current built-in baseline.
 * Older editor versions derived a fresh id (`minorLab2`, `minorLab3`, ...) on
 * Save As. A prior migration preserved the newest of those revisions, which
 * could still supersede the committed baseline with a partially loaded world.
 *
 * Unversioned revisions are deliberately retired: the repository baseline is
 * the recovery copy and must be the first Minor Lab loaded after this upgrade.
 * Subsequent saves carry MINOR_LAB_BASELINE_VERSION and overwrite one canonical
 * slot. The cleaned index is verified before obsolete payload keys are removed.
 */
export function consolidateMinorLabScenarios(storage = globalThis.localStorage) {
  if (!storage) return null;
  const previousIndex = storage.getItem(CUSTOM_SCENARIO_INDEX_KEY);
  const index = parseCustomScenarioIndex(previousIndex, { strict: true });
  const candidates = index.map((entry, order) => ({
    entry,
    order,
    payload: parseStoredScenario(storage.getItem(customScenarioStorageKey(entry.id))),
  })).filter(candidate => isMinorLabEntry(candidate.entry) || isMinorLabEntry(candidate.payload));
  if (!candidates.length) return null;
  if (candidates.length === 1
    && candidates[0].entry.id === MINOR_LAB_SCENARIO_ID
    && candidates[0].payload?.id === MINOR_LAB_SCENARIO_ID
    && candidates[0].payload?.minorLabBaselineVersion === MINOR_LAB_BASELINE_VERSION
    && candidates[0].payload?.data) {
    return candidates[0].payload;
  }

  const valid = candidates.filter(candidate => candidate.payload?.data
    && candidate.payload.minorLabBaselineVersion === MINOR_LAB_BASELINE_VERSION);
  const canonicalKey = customScenarioStorageKey(MINOR_LAB_SCENARIO_ID);
  const previousCanonical = storage.getItem(canonicalKey);
  const cleanedIndex = index.filter(entry => !candidates.some(candidate => candidate.entry === entry));

  if (!valid.length) {
    const cleanedText = JSON.stringify(cleanedIndex);
    try {
      storage.setItem(CUSTOM_SCENARIO_INDEX_KEY, cleanedText);
      if (storage.getItem(CUSTOM_SCENARIO_INDEX_KEY) !== cleanedText) {
        throw new Error('Could not verify the cleaned Minor Lab catalogue');
      }
    } catch (error) {
      try {
        if (previousIndex == null) storage.removeItem(CUSTOM_SCENARIO_INDEX_KEY);
        else storage.setItem(CUSTOM_SCENARIO_INDEX_KEY, previousIndex);
      } catch (_) {}
      throw error;
    }
    for (const candidate of candidates) {
      try { storage.removeItem(customScenarioStorageKey(candidate.entry.id)); } catch (_) {}
    }
    return null;
  }

  valid.sort((a, b) => {
    const aTime = a.payload.updatedAt || a.entry.updatedAt || 0;
    const bTime = b.payload.updatedAt || b.entry.updatedAt || 0;
    return bTime - aTime || b.order - a.order;
  });
  const winner = valid[0].payload;
  const canonical = {
    ...winner,
    id: MINOR_LAB_SCENARIO_ID,
    name: 'Minor Lab',
    minorLabBaselineVersion: MINOR_LAB_BASELINE_VERSION,
    updatedAt: winner.updatedAt || valid[0].entry.updatedAt || Date.now(),
  };
  cleanedIndex.push({
    id: canonical.id,
    name: canonical.name,
    desc: canonical.desc || '',
    sandbox: canonical.sandbox !== false,
    updatedAt: canonical.updatedAt,
  });
  const payloadText = JSON.stringify(canonical);
  const indexText = JSON.stringify(cleanedIndex);

  try {
    storage.setItem(canonicalKey, payloadText);
    storage.setItem(CUSTOM_SCENARIO_INDEX_KEY, indexText);
    if (storage.getItem(canonicalKey) !== payloadText
      || storage.getItem(CUSTOM_SCENARIO_INDEX_KEY) !== indexText) {
      throw new Error('Could not verify the consolidated Minor Lab scenario');
    }
  } catch (error) {
    try {
      if (previousCanonical == null) storage.removeItem(canonicalKey);
      else storage.setItem(canonicalKey, previousCanonical);
    } catch (_) {}
    try {
      if (previousIndex == null) storage.removeItem(CUSTOM_SCENARIO_INDEX_KEY);
      else storage.setItem(CUSTOM_SCENARIO_INDEX_KEY, previousIndex);
    } catch (_) {}
    throw error;
  }

  for (const candidate of candidates) {
    if (candidate.entry.id === MINOR_LAB_SCENARIO_ID) continue;
    try { storage.removeItem(customScenarioStorageKey(candidate.entry.id)); } catch (_) {}
  }
  return canonical;
}

const REQUIRED_SCENARIO_ARRAYS = ['floors', 'zones', 'walls', 'doors', 'placeables'];
const OPTIONAL_SCENARIO_ARRAYS = [
  'wallOverlays',
  'windows',
  'beamPipes',
  'utilityLines',
  'cornerHeights',
  'infraBlockers',
];
const SCENARIO_COUNTER_DEFAULTS = {
  placeableNextId: 1,
  beamPipeNextId: 1,
  placementNextId: 0,
  utilityNextId: 1,
};

/**
 * Validate and detach a downloaded Scenario Admin payload before it reaches
 * Game.applyScenario. The returned object contains only JSON data, so applying
 * it cannot mutate the caller's parsed file object.
 */
export function normalizeScenarioExport(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('The file does not contain a scenario object');
  }
  const id = typeof payload.id === 'string' ? payload.id.trim() : '';
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  if (!id) throw new Error('The scenario is missing an id');
  if (!name) throw new Error('The scenario is missing a name');
  if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
    throw new Error('The scenario is missing its world data');
  }

  // Scenario files are JSON by contract. Cloning here also rejects values
  // that cannot survive the same export/import round trip used by the UI.
  let data;
  try { data = JSON.parse(JSON.stringify(payload.data)); }
  catch (_) { throw new Error('The scenario world data is not valid JSON'); }

  for (const field of REQUIRED_SCENARIO_ARRAYS) {
    if (!Array.isArray(data[field])) {
      throw new Error(`The scenario world data has no valid ${field} array`);
    }
  }
  for (const field of OPTIONAL_SCENARIO_ARRAYS) {
    if (data[field] == null) data[field] = [];
    else if (!Array.isArray(data[field])) {
      throw new Error(`The scenario world data has no valid ${field} array`);
    }
  }
  if (data.utilityLines.some(entry => !Array.isArray(entry) || entry.length !== 2)) {
    throw new Error('The scenario utilityLines array is not a list of map entries');
  }
  if (data.cornerHeights.some(entry => !Array.isArray(entry) || entry.length !== 2)) {
    throw new Error('The scenario cornerHeights array is not a list of map entries');
  }
  for (const [field, fallback] of Object.entries(SCENARIO_COUNTER_DEFAULTS)) {
    if (data[field] == null) data[field] = fallback;
    if (!Number.isInteger(data[field]) || data[field] < 0) {
      throw new Error(`The scenario world data has an invalid ${field}`);
    }
  }

  return {
    id,
    name,
    desc: typeof payload.desc === 'string' ? payload.desc : '',
    sandbox: payload.sandbox !== false,
    data,
  };
}

export function parseScenarioExport(text) {
  let payload;
  try { payload = JSON.parse(String(text)); }
  catch (_) { throw new Error('The selected file is not valid JSON'); }
  return normalizeScenarioExport(payload);
}

function isNewGameBuiltInScenario(scenario) {
  return scenario?.id === 'sandbox' || scenario?.id === 'minorLab';
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

/**
 * Upgrade the old single custom-scenario slot into the current catalogue.
 *
 * The legacy payload is the recovery copy until both the per-scenario payload
 * and catalogue index can be read back. Only then are the retired keys
 * removed, so a quota or storage failure cannot strand the authored world.
 */
export function migrateLegacyCustomScenario(storage = globalThis.localStorage) {
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
  const stored = existingPayload || {
    id,
    name: legacy.name || 'Custom Scenario',
    desc: legacy.desc || '',
    data: legacy.data,
    sandbox: legacy.sandbox !== false,
    updatedAt: legacy.updatedAt || Date.now(),
  };
  if (!existingPayload) {
    storage.setItem(customScenarioStorageKey(id), JSON.stringify(stored));
  }

  const metadata = {
    id,
    name: stored.name || legacy.name || 'Custom Scenario',
    desc: stored.desc || legacy.desc || '',
    sandbox: stored.sandbox !== false,
    updatedAt: stored.updatedAt || legacy.updatedAt || Date.now(),
  };
  if (existing) Object.assign(existing, metadata);
  else index.push(metadata);
  writeCustomScenarioIndex(storage, index);

  const migratedPayload = parseStoredScenario(storage.getItem(customScenarioStorageKey(id)));
  const migratedIndex = readCustomScenarioIndex(storage);
  if (!migratedPayload || !migratedIndex.some(entry => entry.id === id)) {
    throw new Error(`Could not verify migrated scenario "${id}"`);
  }

  storage.removeItem(CUSTOM_SCENARIO_KEY);
  storage.removeItem(DEFAULT_STARTING_SCENARIO_KEY);
  return migratedPayload;
}

/** Return every valid browser-local playable scenario, newest first. */
export function listCustomScenarios(storage = globalThis.localStorage) {
  try { migrateLegacyCustomScenario(storage); }
  catch (_) { /* A read should still degrade to an empty catalogue. */ }
  try { consolidateMinorLabScenarios(storage); }
  catch (_) { /* Keep the last verified catalogue readable on cleanup failure. */ }
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
    consolidateMinorLabScenarios(storage);
    const direct = parseStoredScenario(storage?.getItem(customScenarioStorageKey(id)));
    if (direct) return direct;
    if (isMinorLabIdentifier(id)) {
      return parseStoredScenario(storage?.getItem(customScenarioStorageKey(MINOR_LAB_SCENARIO_ID)));
    }
    return null;
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
  consolidateMinorLabScenarios(storage);
  const canonicalMinorLab = isMinorLabIdentifier(payload.id) || isMinorLabIdentifier(payload.name);
  const stored = {
    id: canonicalMinorLab ? MINOR_LAB_SCENARIO_ID : String(payload.id),
    name: canonicalMinorLab ? 'Minor Lab' : (payload.name || 'Custom Scenario'),
    desc: payload.desc || '',
    data: payload.data,
    sandbox: payload.sandbox !== false,
    updatedAt: Date.now(),
  };
  if (canonicalMinorLab) stored.minorLabBaselineVersion = MINOR_LAB_BASELINE_VERSION;
  const payloadKey = customScenarioStorageKey(stored.id);
  // Saving spans two localStorage keys. Keep the exact prior strings so any
  // failed or unverifiable write can roll back instead of orphaning a payload,
  // dropping the catalogue, or destroying the previous version on overwrite.
  const previousPayload = storage.getItem(payloadKey);
  const previousIndex = storage.getItem(CUSTOM_SCENARIO_INDEX_KEY);
  const index = parseCustomScenarioIndex(previousIndex, { strict: true });
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
  const payloadText = JSON.stringify(stored);
  const indexText = JSON.stringify(index);
  try {
    storage.setItem(payloadKey, payloadText);
    storage.setItem(CUSTOM_SCENARIO_INDEX_KEY, indexText);
    if (storage.getItem(payloadKey) !== payloadText
      || storage.getItem(CUSTOM_SCENARIO_INDEX_KEY) !== indexText) {
      throw new Error(`Could not verify saved scenario "${stored.id}"`);
    }
    return stored;
  } catch (error) {
    const restore = (key, previous) => {
      if (previous == null) storage.removeItem(key);
      else storage.setItem(key, previous);
    };
    // Roll back in reverse write order. Preserve the original error so quota
    // recovery can recognize it and retry after evicting an autosave.
    // Restore unconditionally: a storage adapter may write and then throw.
    try { restore(CUSTOM_SCENARIO_INDEX_KEY, previousIndex); } catch (_) {}
    try { restore(payloadKey, previousPayload); } catch (_) {}
    throw error;
  }
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
  return SCENARIOS.find(s => s.id === id && isNewGameBuiltInScenario(s)) || null;
}

/** Local starter situations, then stock choices that have not been locally overridden. */
export function listPlayableScenarios(storage = globalThis.localStorage) {
  const local = listCustomScenarios(storage)
    .map(scenario => resolveScenario(customScenarioRef(scenario.id), storage))
    .filter(Boolean);
  const localIds = new Set(local.map(scenario => scenario.localId));
  return [...local, ...SCENARIOS.filter(scenario =>
    isNewGameBuiltInScenario(scenario) && !localIds.has(scenario.id))];
}

/** Stage a picker selection for the existing post-reload scenario boot path. */
export function stageScenarioSelection(id, storage = globalThis.localStorage) {
  const scenario = resolveScenario(id, storage);
  if (!scenario) return null;
  if (!storage) throw new Error('Storage is unavailable');
  if (scenario.generator) {
    storage.setItem(PENDING_SCENARIO_KEY, scenario.id);
    if (storage.getItem(PENDING_SCENARIO_KEY) !== scenario.id) {
      throw new Error(`Could not stage scenario "${scenario.name}"`);
    }
  } else {
    storage.removeItem(PENDING_SCENARIO_KEY);
    if (storage.getItem(PENDING_SCENARIO_KEY) != null) {
      throw new Error('Could not clear the previously staged scenario');
    }
  }
  return scenario;
}

export const SCENARIOS = [
  {
    id: MINOR_LAB_SCENARIO_ID,
    name: 'Minor Lab',
    desc: 'A complete working laboratory campus authored in Scenario Admin. Edit it, then Save to replace this same Minor Lab starting situation.',
    difficulty: 'Editable',
    generator: generateMinorLab,
    setup: setupMinorLab,
    editable: true,
  },
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
