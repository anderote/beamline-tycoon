// Local Scenario Admin catalogue, Save As, and New Game picker contracts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CUSTOM_SCENARIO_ID,
  CUSTOM_SCENARIO_INDEX_KEY,
  CUSTOM_SCENARIO_KEY,
  DEFAULT_STARTING_SCENARIO_KEY,
  PENDING_SCENARIO_KEY,
  customScenarioRef,
  listCustomScenarios,
  listPlayableScenarios,
  loadCustomScenarioById,
  resolveScenario,
  saveCustomScenario,
  stageScenarioSelection,
} from '../src/data/scenarios.js';
import {
  ScenarioEditor,
  scenarioIdFromName,
  uniqueScenarioId,
} from '../src/ui/ScenarioEditor.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

const baseData = {
  floors: [{ type: 'concrete', col: 2, row: 3 }],
  zones: [], walls: [], wallOverlays: [], doors: [], windows: [], placeables: [],
  placeableNextId: 1, beamPipes: [], utilityLines: [],
};

// Saving distinct ids creates distinct playable entries; saving an existing
// id is an overwrite, which is the persistence boundary behind Save As.
const storage = memoryStorage();
saveCustomScenario({
  id: 'balanceLab',
  name: 'Balance Lab',
  data: baseData,
  sandbox: true,
}, { storage });
saveCustomScenario({
  id: 'trainingHall',
  name: 'Training Hall',
  data: { ...baseData, floors: [{ type: 'labFloor', col: 5, row: 6 }] },
  sandbox: true,
}, { storage });

assert.equal(listCustomScenarios(storage).length, 2,
  'Save As creates multiple independently playable local scenarios');
assert.equal(listPlayableScenarios(storage).filter(scenario => scenario.local).length, 2,
  'every local scenario is included in the New Game catalogue');

const balanceRef = customScenarioRef('balanceLab');
const resolved = resolveScenario(balanceRef, storage);
assert.equal(resolved?.name, 'Balance Lab');
assert.equal(resolved?.localId, 'balanceLab');
assert.equal(resolved?.sandbox, true,
  'the scenario carries its balance-sandbox launch mode');
assert.deepEqual(resolved?.generator(), baseData);

const revisedData = { ...baseData, floors: [{ type: 'concrete', col: 8, row: 9 }] };
saveCustomScenario({ id: 'balanceLab', name: 'Balance Lab Revised', data: revisedData }, { storage });
assert.equal(listCustomScenarios(storage).length, 2,
  'selecting an existing Save As destination overwrites rather than duplicates');
assert.deepEqual(loadCustomScenarioById('balanceLab', storage)?.data, revisedData);

assert.equal(stageScenarioSelection(balanceRef, storage)?.id, balanceRef);
assert.equal(storage.getItem(PENDING_SCENARIO_KEY), balanceRef,
  'a local picker choice stages its stable catalogue reference');
assert.equal(stageScenarioSelection('sandbox', storage)?.id, 'sandbox');
assert.equal(storage.getItem(PENDING_SCENARIO_KEY), null,
  'the explicit Sandbox picker choice clears pending scenario data for a blank map');

// Existing users' old single custom slot migrates into the multi-scenario
// catalogue instead of disappearing after the feature upgrade.
const legacyStorage = memoryStorage();
legacyStorage.setItem(CUSTOM_SCENARIO_KEY, JSON.stringify({
  id: 'legacyLab', name: 'Legacy Lab', data: baseData, sandbox: true,
}));
legacyStorage.setItem(DEFAULT_STARTING_SCENARIO_KEY, CUSTOM_SCENARIO_ID);
assert.equal(listCustomScenarios(legacyStorage)[0]?.id, 'legacyLab');
assert.equal(legacyStorage.getItem(CUSTOM_SCENARIO_KEY), null);
assert.equal(legacyStorage.getItem(DEFAULT_STARTING_SCENARIO_KEY), null,
  'the retired implicit New Game default is removed during migration');
assert.ok(legacyStorage.getItem(CUSTOM_SCENARIO_INDEX_KEY),
  'the migrated scenario is indexed in the new catalogue');
assert.equal(resolveScenario(CUSTOM_SCENARIO_ID, legacyStorage)?.name, 'Legacy Lab',
  'old pending custom-scenario references still resolve after migration');

assert.equal(scenarioIdFromName('My Cool Lab'), 'myCoolLab');
assert.equal(scenarioIdFromName('42 MeV Starter'), 'custom42MevStarter');
assert.equal(uniqueScenarioId('My Cool Lab', ['myCoolLab', 'myCoolLab2']), 'myCoolLab3');

const editorStorage = memoryStorage();
const editorLog = [];
const editorState = {
  floors: [], zones: [], walls: [], wallOverlays: [], doors: [], windows: [], placeables: [],
  placeableNextId: 1, cornerHeights: new Map(), beamPipes: [], beamPipeNextId: 1,
  placementNextId: 0, utilityLines: new Map(), utilityNextId: 1,
};
const editor = new ScenarioEditor({
  state: editorState,
  log: message => editorLog.push(message),
}, null, { fresh: true, storage: editorStorage });

assert.equal(editor.hasUnsavedChanges(), true,
  'a new editor project starts as an unsaved design');
const savedDraft = editor.saveAs({ id: 'draftWorld', name: 'Draft World' });
assert.equal(savedDraft?.name, 'Draft World');
assert.equal(editor.hasUnsavedChanges(), false,
  'Save As establishes a resumable checkpoint without leaving the editor');
assert.match(editorLog.at(-1), /playable New Game scenario/i);

editorState.floors.push({ type: 'concrete', col: 8, row: 9 });
assert.equal(editor.hasUnsavedChanges(), true,
  'world edits after a save are detected before exiting');
editor.saveDesign();
assert.equal(editor.hasUnsavedChanges(), false,
  'Save updates the scenario identity chosen by the last Save As');
assert.deepEqual(loadCustomScenarioById('draftWorld', editorStorage)?.data.floors, editorState.floors);

editor.saveAs({ id: 'secondDraft', name: 'Second Draft' });
assert.equal(listCustomScenarios(editorStorage).length, 2,
  'the editor can publish another scenario without deleting the first');

// This is intentionally a source-level composition assertion: DOM interaction
// remains in the owner-run browser lane, while the non-browser gate pins that
// both New Game surfaces route to the same picker coordinator.
const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const titleSource = readFileSync(new URL('../src/ui/TitleScreen.js', import.meta.url), 'utf8');
const htmlSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(mainSource, /case 'new-game':\s*scenarioPicker\.open\(\)/);
assert.match(mainSource, /onNewGame:\s*\(\) => scenarioPicker\.open\(\)/);
assert.doesNotMatch(titleSource, /addBtn\('Scenarios'/,
  'the separate title Scenarios action is folded into New Game');
assert.doesNotMatch(htmlSource, /data-action="scenarios"/,
  'the in-game menu exposes one unambiguous New Game picker action');

console.log('Scenario construction persistence: all assertions passed');
