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
import { ScenarioEditor } from '../src/ui/ScenarioEditor.js';

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

const editorStorage = memoryStorage();
const editorLog = [];
const editorState = {
  floors: [],
  zones: [],
  walls: [],
  doors: [],
  windows: [],
  placeables: [],
  placeableNextId: 1,
  cornerHeights: new Map(),
  beamPipes: [],
  beamPipeNextId: 1,
  placementNextId: 0,
  utilityLines: new Map(),
  utilityNextId: 1,
};
const editor = new ScenarioEditor({
  state: editorState,
  log: message => editorLog.push(message),
}, null, { fresh: true, storage: editorStorage });

assert.equal(editor.hasUnsavedChanges(), true,
  'a new editor project starts as an unsaved design');
const savedDraft = editor.saveDesign({ id: 'draftWorld', name: 'Draft World' });
assert.equal(savedDraft?.name, 'Draft World');
assert.equal(editor.hasUnsavedChanges(), false,
  'Save Design establishes a resumable checkpoint without leaving the editor');
assert.equal(loadCustomScenario(editorStorage)?.name, 'Draft World');
assert.equal(editorStorage.getItem(DEFAULT_STARTING_SCENARIO_KEY), CUSTOM_SCENARIO_ID,
  'a saved editor project is also the local default world');
assert.match(editorLog.at(-1), /resume it later/i);

editorState.floors.push({ type: 'concrete', col: 8, row: 9 });
assert.equal(editor.hasUnsavedChanges(), true,
  'world edits after a save are detected before exiting');
editor.saveDesign();
assert.equal(editor.hasUnsavedChanges(), false,
  'later saves reuse the current project identity without another naming step');
assert.deepEqual(loadCustomScenario(editorStorage)?.data.floors, editorState.floors);

console.log('Scenario construction persistence: all assertions passed');
