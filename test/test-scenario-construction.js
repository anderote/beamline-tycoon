// Local Scenario Admin persistence and New Game default staging.
import assert from 'node:assert/strict';
import {
  CUSTOM_SCENARIO_ID,
  CUSTOM_SCENARIO_KEY,
  DEFAULT_STARTING_SCENARIO_KEY,
  PENDING_SCENARIO_KEY,
  loadCustomScenario,
  loadDefaultStartingScenarioId,
  resolveScenario,
  saveCustomScenario,
  stageDefaultStartingScenario,
} from '../src/data/scenarios.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

const storage = memoryStorage();
const data = {
  floors: [{ type: 'concrete', col: 2, row: 3 }],
  zones: [], walls: [], doors: [], windows: [], placeables: [],
  placeableNextId: 1, beamPipes: [], utilityLines: [],
};

const saved = saveCustomScenario({
  id: 'balanceLab',
  name: 'Balance Lab',
  data,
  sandbox: true,
}, { storage });

assert.equal(saved.sandbox, true);
assert.equal(storage.getItem(DEFAULT_STARTING_SCENARIO_KEY), CUSTOM_SCENARIO_ID,
  'saving from Scenario Admin makes the custom layout the local New Game default');
assert.deepEqual(loadCustomScenario(storage)?.data, data,
  'the complete constructed map is restored from the local slot');
assert.equal(loadDefaultStartingScenarioId(storage), CUSTOM_SCENARIO_ID,
  'the default is returned only while its scenario payload resolves');

const resolved = resolveScenario(CUSTOM_SCENARIO_ID, storage);
assert.equal(resolved?.name, 'Balance Lab');
assert.equal(resolved?.sandbox, true,
  'the scenario carries its balance-sandbox launch mode');
assert.deepEqual(resolved?.generator(), data);

assert.equal(stageDefaultStartingScenario(storage), CUSTOM_SCENARIO_ID);
assert.equal(storage.getItem(PENDING_SCENARIO_KEY), CUSTOM_SCENARIO_ID,
  'New Game stages the local default through the normal pending-scenario boot path');

storage.removeItem(CUSTOM_SCENARIO_KEY);
assert.equal(loadDefaultStartingScenarioId(storage), null,
  'a dangling default never resolves after its scenario payload is removed');
assert.equal(stageDefaultStartingScenario(storage), null);
assert.equal(storage.getItem(PENDING_SCENARIO_KEY), null,
  'staging without a valid default clears any stale pending scenario');

console.log('Scenario construction persistence: all assertions passed');
