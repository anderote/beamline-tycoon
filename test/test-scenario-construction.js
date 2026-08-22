// Local Scenario Admin catalogue, Save As, and New Game picker contracts.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  CUSTOM_SCENARIO_ID,
  CUSTOM_SCENARIO_INDEX_KEY,
  CUSTOM_SCENARIO_KEY,
  CUSTOM_SCENARIO_PREFIX,
  DEFAULT_STARTING_SCENARIO_KEY,
  MINOR_LAB_SCENARIO_ID,
  PENDING_SCENARIO_KEY,
  consolidateMinorLabScenarios,
  customScenarioRef,
  listCustomScenarios,
  listPlayableScenarios,
  loadCustomScenarioById,
  migrateLegacyCustomScenario,
  parseScenarioExport,
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
assert.deepEqual(
  listPlayableScenarios(storage).filter(scenario => !scenario.local).map(scenario => scenario.id),
  ['minorLab', 'sandbox'],
  'New Game exposes Minor Lab as its stock editable starting situation plus Sandbox');
assert.equal(resolveScenario('minorLab', storage)?.name, 'Minor Lab',
  'the stock Minor Lab is launchable from New Game');
assert.equal(resolveScenario('realLab', storage), null,
  'the former Real Lab fixture is not launchable from New Game');
assert.equal(resolveScenario('smallBeamlineFacility', storage), null,
  'the former Small Beamline Facility fixture is not launchable from New Game');

// The stock Minor Lab is the exact latest Scenario Admin export, not the old
// tiny hand-written control nook. Pin its complete data graph and make sure the
// generator returns a detached copy for each New Game session.
const minorLabBaseText = readFileSync(
  new URL('../src/data/scenarios/minorLab.base.json', import.meta.url), 'utf8',
);
const minorLabBase = JSON.parse(minorLabBaseText);
assert.equal(minorLabBase.id, MINOR_LAB_SCENARIO_ID);
assert.equal(minorLabBase.name, 'Minor Lab');
assert.equal(
  createHash('sha256').update(JSON.stringify(minorLabBase.data)).digest('hex'),
  'cb138f0b4e2b709a87d18c3f86c2b8c5076a58ae534062d0bab1f3375a74495f',
  'the complete latest Minor Lab export remains the built-in baseline',
);
const generatedMinorLab = resolveScenario('minorLab', memoryStorage()).generator();
assert.deepEqual(generatedMinorLab, minorLabBase.data);
generatedMinorLab.floors.pop();
assert.equal(resolveScenario('minorLab', memoryStorage()).generator().floors.length, 361,
  'each Minor Lab launch receives an independent copy of the baseline');

const minorOverrideStorage = memoryStorage();
saveCustomScenario({ id: 'minorLab', name: 'Minor Lab', data: baseData }, {
  storage: minorOverrideStorage,
});
assert.deepEqual(listPlayableScenarios(minorOverrideStorage).map(scenario => scenario.id),
  [customScenarioRef('minorLab'), 'sandbox'],
  'saving an edited Minor Lab replaces the stock card instead of duplicating it');

// Older Scenario Admin builds minted minorLab2/minorLab3/minorLab4 for the
// same display name. New Game consolidates them to one canonical override,
// retaining the newest world and removing the obsolete indexed payloads.
const duplicateMinorStorage = memoryStorage();
const minorOldData = { ...baseData, floors: [{ type: 'concrete', col: 1, row: 1 }] };
const minorLatestData = { ...baseData, floors: [{ type: 'concrete', col: 9, row: 9 }] };
const seedMinor = (id, data, updatedAt) => {
  duplicateMinorStorage.setItem(`${CUSTOM_SCENARIO_PREFIX}${id}`, JSON.stringify({
    id, name: 'Minor Lab', data, sandbox: true, updatedAt,
  }));
};
seedMinor('minorLab2', minorOldData, 100);
seedMinor('minorLab4', minorLatestData, 400);
duplicateMinorStorage.setItem(CUSTOM_SCENARIO_INDEX_KEY, JSON.stringify([
  { id: 'minorLab2', name: 'Minor Lab', sandbox: true, updatedAt: 100 },
  { id: 'minorLab4', name: 'Minor Lab', sandbox: true, updatedAt: 400 },
]));
assert.equal(consolidateMinorLabScenarios(duplicateMinorStorage)?.id, 'minorLab');
assert.deepEqual(listCustomScenarios(duplicateMinorStorage).map(scenario => scenario.id), ['minorLab']);
assert.deepEqual(loadCustomScenarioById('minorLab', duplicateMinorStorage)?.data, minorLatestData,
  'the newest saved Minor Lab revision becomes the canonical local override');
assert.equal(duplicateMinorStorage.getItem(`${CUSTOM_SCENARIO_PREFIX}minorLab2`), null);
assert.equal(duplicateMinorStorage.getItem(`${CUSTOM_SCENARIO_PREFIX}minorLab4`), null);
assert.deepEqual(listPlayableScenarios(duplicateMinorStorage).map(scenario => scenario.id),
  [customScenarioRef('minorLab'), 'sandbox'],
  'duplicate Minor Lab cards collapse to one local override plus Sandbox');

const minorReplacementData = { ...baseData, floors: [{ type: 'labFloor', col: 12, row: 4 }] };
const canonicalMinorSave = saveCustomScenario({
  id: 'minorLab5', name: 'Minor Lab', data: minorReplacementData,
}, { storage: duplicateMinorStorage });
assert.equal(canonicalMinorSave.id, 'minorLab',
  'saving a later Minor Lab filename still overwrites the canonical slot');
assert.deepEqual(loadCustomScenarioById('minorLab5', duplicateMinorStorage)?.data, minorReplacementData,
  'old suffixed Minor Lab references resolve to the canonical saved world');

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

// A scenario save is a two-key transaction: if the catalogue write fails,
// neither a new payload nor a destructive overwrite may remain behind.
const atomicStorage = memoryStorage();
saveCustomScenario({ id: 'atomicLab', name: 'Atomic Lab', data: baseData }, { storage: atomicStorage });
const atomicPayloadKey = `${CUSTOM_SCENARIO_PREFIX}atomicLab`;
const atomicPayloadBefore = atomicStorage.getItem(atomicPayloadKey);
const atomicIndexBefore = atomicStorage.getItem(CUSTOM_SCENARIO_INDEX_KEY);
const atomicSetItem = atomicStorage.setItem;
let refuseIndexOnce = true;
atomicStorage.setItem = (key, value) => {
  if (key === CUSTOM_SCENARIO_INDEX_KEY && refuseIndexOnce) {
    refuseIndexOnce = false;
    throw new DOMException('quota exceeded', 'QuotaExceededError');
  }
  atomicSetItem(key, value);
};
assert.throws(() => saveCustomScenario({
  id: 'atomicLab',
  name: 'Broken Overwrite',
  data: revisedData,
}, { storage: atomicStorage }), /quota/i);
assert.equal(atomicStorage.getItem(atomicPayloadKey), atomicPayloadBefore,
  'a failed overwrite restores the previous complete scenario');
assert.equal(atomicStorage.getItem(CUSTOM_SCENARIO_INDEX_KEY), atomicIndexBefore,
  'a failed overwrite restores the previous catalogue index');

refuseIndexOnce = true;
assert.throws(() => saveCustomScenario({
  id: 'orphanLab',
  name: 'Orphan Lab',
  data: revisedData,
}, { storage: atomicStorage }), /quota/i);
assert.equal(atomicStorage.getItem(`${CUSTOM_SCENARIO_PREFIX}orphanLab`), null,
  'a failed new save does not leave an unlisted payload behind');
atomicStorage.setItem = atomicSetItem;

assert.equal(stageScenarioSelection(balanceRef, storage)?.id, balanceRef);
assert.equal(storage.getItem(PENDING_SCENARIO_KEY), balanceRef,
  'a local picker choice stages its stable catalogue reference');
assert.equal(stageScenarioSelection('sandbox', storage)?.id, 'sandbox');
assert.equal(storage.getItem(PENDING_SCENARIO_KEY), null,
  'the explicit Sandbox picker choice clears pending scenario data for a blank map');

const unreliableStageStorage = memoryStorage();
saveCustomScenario({ id: 'unstageableLab', name: 'Unstageable Lab', data: baseData }, {
  storage: unreliableStageStorage,
});
const reliableStageSetItem = unreliableStageStorage.setItem;
unreliableStageStorage.setItem = (key, value) => {
  if (key !== PENDING_SCENARIO_KEY) reliableStageSetItem(key, value);
};
assert.throws(
  () => stageScenarioSelection(customScenarioRef('unstageableLab'), unreliableStageStorage),
  /Could not stage/,
  'launch refuses to proceed when browser storage silently drops the pending scenario',
);

// Existing users' old single custom slot migrates into the multi-scenario
// catalogue instead of disappearing after the feature upgrade.
const legacyStorage = memoryStorage();
legacyStorage.setItem(CUSTOM_SCENARIO_KEY, JSON.stringify({
  id: 'legacyLab', name: 'Legacy Lab', data: baseData, sandbox: true,
}));
legacyStorage.setItem(DEFAULT_STARTING_SCENARIO_KEY, CUSTOM_SCENARIO_ID);
const migratedLegacy = migrateLegacyCustomScenario(legacyStorage);
assert.equal(migratedLegacy?.id, 'legacyLab');
assert.deepEqual(migratedLegacy?.data, baseData,
  'startup migration preserves the complete authored world payload');
assert.equal(legacyStorage.getItem(CUSTOM_SCENARIO_KEY), null);
assert.equal(legacyStorage.getItem(DEFAULT_STARTING_SCENARIO_KEY), null,
  'the retired implicit New Game default is removed during migration');
assert.ok(legacyStorage.getItem(CUSTOM_SCENARIO_INDEX_KEY),
  'the migrated scenario is indexed in the new catalogue');
assert.ok(legacyStorage.getItem(`${CUSTOM_SCENARIO_PREFIX}legacyLab`),
  'the migrated world is stored in the per-scenario catalogue layout');
assert.equal(resolveScenario(CUSTOM_SCENARIO_ID, legacyStorage)?.name, 'Legacy Lab',
  'old pending custom-scenario references still resolve after migration');
assert.deepEqual(listPlayableScenarios(legacyStorage).map(scenario => scenario.name),
  ['Legacy Lab', 'Minor Lab', 'Sandbox'],
  'a migrated starter, stock Minor Lab, and Sandbox are the New Game choices');

// The old slot remains the recovery source until the new catalogue index is
// safely committed. A quota/write failure may leave an orphan target payload,
// but it must never delete the only indexed copy of the authored world.
const failingMigrationStorage = memoryStorage();
failingMigrationStorage.setItem(CUSTOM_SCENARIO_KEY, JSON.stringify({
  id: 'recoverableLab', name: 'Recoverable Lab', data: baseData, sandbox: true,
}));
failingMigrationStorage.setItem(DEFAULT_STARTING_SCENARIO_KEY, CUSTOM_SCENARIO_ID);
const workingSetItem = failingMigrationStorage.setItem;
failingMigrationStorage.setItem = (key, value) => {
  if (key === CUSTOM_SCENARIO_INDEX_KEY) throw new Error('simulated quota failure');
  workingSetItem(key, value);
};
assert.throws(() => migrateLegacyCustomScenario(failingMigrationStorage), /quota failure/);
assert.ok(failingMigrationStorage.getItem(CUSTOM_SCENARIO_KEY),
  'a failed catalogue write retains the legacy scenario recovery copy');
assert.equal(failingMigrationStorage.getItem(DEFAULT_STARTING_SCENARIO_KEY), CUSTOM_SCENARIO_ID,
  'a failed migration retains the legacy default marker');

assert.equal(scenarioIdFromName('My Cool Lab'), 'myCoolLab');
assert.equal(scenarioIdFromName('42 MeV Starter'), 'custom42MevStarter');
assert.equal(uniqueScenarioId('My Cool Lab', ['myCoolLab', 'myCoolLab2']), 'myCoolLab3');

// Exported and emergency-backup files share one strict import boundary.
const parsedExport = parseScenarioExport(JSON.stringify({
  id: 'majorLab',
  name: 'Major Lab',
  data: baseData,
}));
assert.equal(parsedExport.id, 'majorLab');
assert.deepEqual(parsedExport.data.floors, baseData.floors);
assert.deepEqual(parsedExport.data.cornerHeights, [],
  'older valid exports receive safe defaults for optional world arrays');
assert.equal(parsedExport.data.beamPipeNextId, 1);
assert.throws(() => parseScenarioExport('{not json'), /not valid JSON/);
assert.throws(() => parseScenarioExport(JSON.stringify({
  id: 'brokenLab', name: 'Broken Lab', data: { ...baseData, floors: null },
})), /floors array/);
assert.throws(() => parseScenarioExport(JSON.stringify({
  id: 'brokenLines', name: 'Broken Lines', data: { ...baseData, utilityLines: [{}] },
})), /utilityLines/);

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

// Loading a file replaces only the editor workspace. It remains deliberately
// unsaved until Save As chooses a catalogue destination.
const importStorage = memoryStorage();
const importLog = [];
const importState = {
  floors: [], zones: [], walls: [], wallOverlays: [], doors: [], windows: [], placeables: [],
  placeableNextId: 1, cornerHeights: new Map(), beamPipes: [], beamPipeNextId: 1,
  placementNextId: 0, utilityLines: new Map(), utilityNextId: 1,
};
const importGame = {
  state: importState,
  log: (message, type) => importLog.push({ message, type }),
  applyScenario(data) {
    importState.floors = data.floors;
    importState.zones = data.zones;
    importState.walls = data.walls;
    importState.wallOverlays = data.wallOverlays || [];
    importState.doors = data.doors;
    importState.windows = data.windows || [];
    importState.placeables = data.placeables;
    importState.placeableNextId = data.placeableNextId;
    importState.cornerHeights = new Map(data.cornerHeights || []);
    importState.beamPipes = data.beamPipes || [];
    importState.beamPipeNextId = data.beamPipeNextId || 1;
    importState.placementNextId = data.placementNextId || 0;
    importState.utilityLines = new Map(data.utilityLines || []);
    importState.utilityNextId = data.utilityNextId || 1;
  },
};
const importEditor = new ScenarioEditor(importGame, null, { fresh: true, storage: importStorage });
const loaded = importEditor.loadScenarioPayload(parsedExport, { sourceName: 'majorLab.scenario.json' });
assert.equal(loaded?.name, 'Major Lab');
assert.deepEqual(importState.floors, baseData.floors);
assert.equal(listCustomScenarios(importStorage).length, 0,
  'Load does not silently publish or overwrite a local scenario');
assert.equal(importEditor.hasUnsavedChanges(), true,
  'the imported world is explicitly unsaved work');
assert.match(importLog.at(-1).message, /Use Save As/);
assert.ok(importEditor.saveAs({ id: 'majorLab2', name: 'Major Lab' }));
assert.deepEqual(loadCustomScenarioById('majorLab2', importStorage)?.data.floors, baseData.floors,
  'Save As publishes the imported world under the chosen identity');

const importedMinorLab = parseScenarioExport(JSON.stringify({
  id: 'minorLab4',
  name: 'Minor Lab',
  data: minorLatestData,
}));
assert.ok(importEditor.loadScenarioPayload(importedMinorLab, {
  sourceName: 'minorLab4.scenario.json',
  confirmReplace: () => true,
}));
const savedImportedMinor = importEditor.saveDesign();
assert.equal(savedImportedMinor?.id, 'minorLab',
  'Save on an imported Minor Lab revision directly targets the canonical baseline slot');
assert.deepEqual(loadCustomScenarioById('minorLab', importStorage)?.data.floors,
  minorLatestData.floors);
assert.match(importLog.at(-1).message, /Saved "Minor Lab"/,
  'the direct overwrite is reported as the ordinary saved Minor Lab');

importState.floors.push({ type: 'concrete', col: 9, row: 9 });
const retainedFloors = JSON.stringify(importState.floors);
assert.equal(importEditor.loadScenarioPayload(parsedExport, { confirmReplace: () => false }), null);
assert.equal(JSON.stringify(importState.floors), retainedFloors,
  'declining Load keeps current editor work untouched');
assert.equal(await importEditor.loadScenarioFile({
  name: 'damaged.scenario.json',
  text: async () => '{damaged',
}), null);
assert.match(importLog.at(-1).message, /LOAD FAILED/,
  'an unreadable export is rejected through the visible game log');

// Export keeps a saved scenario's stable id when its display name is unchanged.
const exportState = {
  ...editorState,
  floors: [...baseData.floors],
  cornerHeights: new Map(),
  utilityLines: new Map(),
};
const exportLog = [];
const exportEditor = new ScenarioEditor({
  state: exportState,
  log: (message, type) => exportLog.push({ message, type }),
}, { id: 'majorLab2', name: 'Major Lab', data: baseData }, { storage: memoryStorage() });
const downloads = [];
const realBlob = globalThis.Blob;
const realURL = globalThis.URL;
const realDocument = globalThis.document;
const realPrompt = globalThis.prompt;
const realConsoleLog = console.log;
globalThis.Blob = class { constructor(parts) { this.parts = parts; } };
globalThis.URL = {
  createObjectURL: blob => { downloads.push(blob.parts.join('')); return 'blob:scenario'; },
  revokeObjectURL: () => {},
};
globalThis.document = {
  body: { appendChild: () => {} },
  createElement: () => ({ click: () => {}, remove: () => {} }),
  getElementById: () => null,
};
globalThis.prompt = () => 'Major Lab';
console.log = () => {};
try {
  const exported = exportEditor.exportScenario();
  assert.equal(exported.id, 'majorLab2',
    'Export does not regenerate a different id from an unchanged display name');
  assert.equal(JSON.parse(downloads[0]).id, 'majorLab2');
} finally {
  globalThis.Blob = realBlob;
  globalThis.URL = realURL;
  globalThis.document = realDocument;
  globalThis.prompt = realPrompt;
  console.log = realConsoleLog;
}

// This is intentionally a source-level composition assertion: DOM interaction
// remains in the owner-run browser lane, while the non-browser gate pins that
// both New Game surfaces route to the same picker coordinator.
const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const pickerSource = readFileSync(new URL('../src/ui/ScenarioPicker.js', import.meta.url), 'utf8');
const titleSource = readFileSync(new URL('../src/ui/TitleScreen.js', import.meta.url), 'utf8');
const htmlSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(mainSource, /case 'new-game':\s*scenarioPicker\.open\(\)/);
assert.match(mainSource, /onNewGame:\s*\(\) => scenarioPicker\.open\(\)/);
assert.match(mainSource, /try \{ migrateLegacyCustomScenario\(\); \}/,
  'app startup eagerly migrates the legacy single scenario slot');
assert.match(pickerSource, /data-edit-scenario=/,
  'the migrated starter remains reopenable in Scenario Editor');
assert.doesNotMatch(titleSource, /addBtn\('Scenarios'/,
  'the separate title Scenarios action is folded into New Game');
assert.doesNotMatch(htmlSource, /data-action="scenarios"/,
  'the in-game menu exposes one unambiguous New Game picker action');
const editorSource = readFileSync(new URL('../src/ui/ScenarioEditor.js', import.meta.url), 'utf8');
assert.match(editorSource, /mk\('Load'.*chooseScenarioFile/,
  'Scenario Admin exposes the file Load action in its yellow toolbar');

console.log('Scenario construction persistence: all assertions passed');
