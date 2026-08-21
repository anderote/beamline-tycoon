// Scenario Editor crash/quota recovery: the working scenario is persisted on
// its own recovery key while dirty, offered back on the next editor boot, and
// a save that storage refuses hands the author a file instead of an alert().
//
// This is the suite for the incident that motivated the feature: a 1793-floor
// scenario with hours of work in it, a Save that hit the origin quota, and
// nothing anywhere to recover from.
import assert from 'node:assert/strict';
import {
  CUSTOM_SCENARIO_PREFIX,
  listCustomScenarios,
  loadCustomScenarioById,
} from '../src/data/scenarios.js';
import {
  ScenarioEditor,
  SCENARIO_RECOVERY_KEY,
  SCENARIO_AUTOSAVE_INTERVAL,
} from '../src/ui/ScenarioEditor.js';
import { deserializeCornerHeights } from '../src/game/terrain.js';
import { SaveSlots, AUTOSAVE_PREFIX } from '../src/game/SaveSlots.js';

// ---------------------------------------------------------------- doubles --

function memoryStorage({ limit = Infinity } = {}) {
  const values = new Map();
  const used = () => [...values.entries()].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    values,
    keys: () => [...values.keys()],
    setLimit(next) { limit = next; },
    getItem: key => (values.has(key) ? values.get(key) : null),
    setItem(key, value) {
      const text = String(value);
      const previous = values.has(key) ? key.length + values.get(key).length : 0;
      if (used() - previous + key.length + text.length > limit) {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      }
      values.set(key, text);
    },
    removeItem(key) { values.delete(key); },
  };
}

function blankState() {
  return {
    floors: [], zones: [], walls: [], wallOverlays: [], doors: [], windows: [],
    placeables: [], placeableNextId: 1, cornerHeights: new Map(),
    beamPipes: [], beamPipeNextId: 1, placementNextId: 0,
    utilityLines: new Map(), utilityNextId: 1,
  };
}

// A stand-in for Game that honours the same applyScenario contract the editor
// relies on, so the restore path is exercised at its real seam.
function stubGame() {
  const state = blankState();
  const logs = [];
  return {
    state,
    logs,
    log: (msg, type = '') => logs.push({ msg, type }),
    applyScenario(data) {
      state.floors = data.floors;
      state.zones = data.zones;
      state.walls = data.walls;
      state.wallOverlays = data.wallOverlays || [];
      state.doors = data.doors;
      state.windows = data.windows || [];
      state.placeables = data.placeables;
      state.placeableNextId = data.placeableNextId;
      state.beamPipes = data.beamPipes || [];
      state.beamPipeNextId = data.beamPipeNextId || 1;
      state.placementNextId = data.placementNextId || 0;
      state.utilityLines = new Map(data.utilityLines || []);
      state.utilityNextId = data.utilityNextId || 1;
      if (data.cornerHeights) {
        state.cornerHeights = data.cornerHeights instanceof Map
          ? data.cornerHeights
          : deserializeCornerHeights(data.cornerHeights);
      }
    },
  };
}

function buildWorld(state, floorCount) {
  for (let i = 0; i < floorCount; i++) state.floors.push({ type: 'labFloor', col: i, row: 1 });
  state.walls.push({ col: 0, row: 0, side: 'N', type: 'concrete' });
  state.placeables.push({ id: 1, type: 'desk', col: 2, row: 2, category: 'furniture' });
}

// ------------------------------------ the recovery key is its own territory --

assert.ok(!SCENARIO_RECOVERY_KEY.startsWith(CUSTOM_SCENARIO_PREFIX),
  'a periodic draft must never live where a deliberately published scenario lives');
assert.ok(SCENARIO_AUTOSAVE_INTERVAL > 0 && SCENARIO_AUTOSAVE_INTERVAL <= 5 * 60 * 1000,
  'the editor banks work at least every few minutes');

// ------------------------------------------------ autosave while dirty ------

{
  const storage = memoryStorage();
  const game = stubGame();
  const editor = new ScenarioEditor(game, null, { fresh: true, storage });
  buildWorld(game.state, 12);

  assert.equal(editor.hasUnsavedChanges(), true);
  const draft = editor.autosaveDraft();
  assert.ok(draft, 'dirty editor work is banked');

  const raw = storage.getItem(SCENARIO_RECOVERY_KEY);
  assert.ok(raw, 'the draft is written to the dedicated recovery key');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.data.floors.length, 12, 'the whole world is in the draft');
  assert.ok(Number.isFinite(parsed.savedAt), 'the draft records when it was taken');
  assert.equal(listCustomScenarios(storage).length, 0,
    'a recovery draft never appears in the New Game catalogue');
  assert.deepEqual(storage.keys().filter(k => k.startsWith(CUSTOM_SCENARIO_PREFIX)), [],
    'a recovery draft never occupies a published scenario key');

  // Unchanged world: no second write, so a long session costs one key once.
  assert.equal(editor.autosaveDraft(), null, 'an unchanged world is not rewritten');
  buildWorld(game.state, 3);
  assert.ok(editor.autosaveDraft(), 'further edits are banked');
  assert.equal(JSON.parse(storage.getItem(SCENARIO_RECOVERY_KEY)).data.floors.length, 15);
  assert.equal(storage.keys().filter(k => k === SCENARIO_RECOVERY_KEY).length, 1,
    'the draft is rewritten in place rather than accumulating');
}

// ------------------------------- restoring the draft on the next editor boot --

{
  const storage = memoryStorage();
  const crashed = stubGame();
  const crashedEditor = new ScenarioEditor(crashed, null, { fresh: true, storage });
  buildWorld(crashed.state, 40);
  crashed.state.utilityLines.set(7, { utility: 'powerCable', path: [[1, 1], [1, 2]] });
  crashed.state.cornerHeights.set('3,4', Int8Array.from([1, 2, 3, 4]));
  crashedEditor._lastName = 'Major Lab';
  crashedEditor.autosaveDraft();
  // The tab dies here.

  const reopened = stubGame();
  const editor = new ScenarioEditor(reopened, null, { fresh: true, storage });
  const found = editor.readRecoveryDraft();
  assert.ok(found, 'the next editor boot finds the draft');
  assert.equal(found.name, 'Major Lab');

  // Cancelling the offer keeps the stored scenario and drops the draft.
  const declining = new ScenarioEditor(stubGame(), null, { fresh: true, storage });
  globalThis.confirm = () => false;
  assert.equal(declining.offerRecoveryRestore(), false, 'the author may decline');
  assert.equal(storage.getItem(SCENARIO_RECOVERY_KEY), null,
    'a declined draft is discarded so it is not offered forever');

  // Accepting it rebuilds the world through applyScenario.
  crashedEditor.autosaveDraft({ force: true });
  globalThis.confirm = () => true;
  assert.equal(editor.offerRecoveryRestore(), true);
  delete globalThis.confirm;
  assert.equal(reopened.state.floors.length, 40, 'the recovered world is live in the editor');
  assert.equal(reopened.state.utilityLines.get(7)?.utility, 'powerCable',
    'Map-backed state survives the round trip');
  assert.deepEqual([...reopened.state.cornerHeights.get('3,4')], [1, 2, 3, 4],
    'terrain survives the round trip');
  assert.equal(editor.hasUnsavedChanges(), true,
    'recovered work is unsaved work — it still has to be published');
  assert.match(reopened.logs.at(-1).msg, /Restored unsaved scenario work/);

  // Publishing it clears the draft: a stale offer on the next boot is noise.
  assert.ok(editor.saveAs({ id: 'majorLab', name: 'Major Lab' }));
  assert.equal(storage.getItem(SCENARIO_RECOVERY_KEY), null,
    'a deliberate save supersedes the recovery copy');
  assert.equal(loadCustomScenarioById('majorLab', storage)?.data.floors.length, 40);
  assert.equal(editor.autosaveDraft(), null,
    'a saved, unmodified scenario needs no recovery draft');
}

// --------------------------------------------------- beforeunload handling --

{
  const storage = memoryStorage();
  const game = stubGame();
  const listeners = new Map();
  globalThis.window = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
  };
  try {
    const editor = new ScenarioEditor(game, null, { fresh: true, storage });
    buildWorld(game.state, 6);
    const timer = editor.startDraftAutosave();
    assert.ok(timer, 'the editor keeps banking work on a timer');
    assert.ok(listeners.has('beforeunload'), 'closing the tab while dirty is intercepted');

    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    listeners.get('beforeunload')(event);
    assert.equal(event.defaultPrevented, true, 'the author is warned before losing the tab');
    assert.equal(JSON.parse(storage.getItem(SCENARIO_RECOVERY_KEY)).data.floors.length, 6,
      'the work is banked before the tab goes away');

    editor.stopDraftAutosave();
    assert.equal(listeners.has('beforeunload'), false, 'teardown removes the handler');
  } finally {
    delete globalThis.window;
  }
}

// ------------------------------------------- the draft respects the quota ---

{
  // A full origin makes room by dropping the oldest *game* autosave; the
  // author's published scenarios and the previous draft are untouchable.
  const storage = memoryStorage({ limit: 30_000 });
  globalThis.localStorage = storage;
  try {
    const game = stubGame();
    const editor = new ScenarioEditor(game, null, { fresh: true, storage });
    editor.saveAs({ id: 'publishedLab', name: 'Published Lab' });
    const publishedBefore = storage.getItem(`${CUSTOM_SCENARIO_PREFIX}publishedLab`);

    const realNow = Date.now;
    let now = 8_000_000;
    Date.now = () => now;
    try {
      for (let i = 0; i < 3; i++) {
        now += 300_001;
        SaveSlots.autosave('g'.repeat(2000), { tick: i });
      }
    } finally { Date.now = realNow; }
    const autosavesBefore = storage.keys().filter(k => k.startsWith(AUTOSAVE_PREFIX)).length;
    assert.ok(autosavesBefore >= 2);

    buildWorld(game.state, 200);
    // Leave room for the draft plus exactly one game snapshot, so writing it
    // must give up the two oldest snapshots and nothing else.
    const snapshotUnits = JSON.stringify(editor.collectScenarioData()).length;
    const protectedUnits = storage.keys()
      .filter(k => !k.startsWith(AUTOSAVE_PREFIX))
      .reduce((n, k) => n + k.length + storage.getItem(k).length, 0);
    storage.setLimit(protectedUnits + snapshotUnits + 2100 + 400);
    const draft = editor.autosaveDraft();
    assert.ok(draft, 'the draft write recovers from a full origin instead of giving up');
    assert.ok(storage.keys().filter(k => k.startsWith(AUTOSAVE_PREFIX)).length < autosavesBefore,
      'expendable game snapshots are what pays for the draft');
    assert.equal(storage.getItem(`${CUSTOM_SCENARIO_PREFIX}publishedLab`), publishedBefore,
      'a published scenario is never sacrificed for a draft');
  } finally {
    globalThis.localStorage = undefined;
  }
}

{
  // Nothing left to evict: keep the previous draft, say so once, stay quiet.
  const storage = memoryStorage();
  const game = stubGame();
  const editor = new ScenarioEditor(game, null, { fresh: true, storage });
  buildWorld(game.state, 5);
  editor.autosaveDraft();
  const survivingDraft = storage.getItem(SCENARIO_RECOVERY_KEY);
  assert.ok(survivingDraft);

  storage.setItem = () => { throw new DOMException('quota exceeded', 'QuotaExceededError'); };
  buildWorld(game.state, 400);
  assert.equal(editor.autosaveDraft(), null);
  assert.equal(storage.getItem(SCENARIO_RECOVERY_KEY), survivingDraft,
    'a stale recovery copy is better than none — a failed write never deletes it');
  const complaints = game.logs.filter(l => /SCENARIO AUTOSAVE FAILED/.test(l.msg));
  assert.equal(complaints.length, 1, 'the failure is reported');
  assert.equal(complaints[0].type, 'bad');
  editor.autosaveDraft();
  editor.autosaveDraft();
  assert.equal(game.logs.filter(l => /SCENARIO AUTOSAVE FAILED/.test(l.msg)).length, 1,
    'a timer-driven failure is reported once, not every minute');
}

// ------------------------------------- a refused save hands over a file -----

{
  const storage = memoryStorage({ limit: 400 });
  const game = stubGame();
  const editor = new ScenarioEditor(game, null, { fresh: true, storage });
  buildWorld(game.state, 30);

  const downloads = [];
  const anchors = [];
  const realBlob = globalThis.Blob;
  const realURL = globalThis.URL;
  globalThis.Blob = class { constructor(parts) { this.parts = parts; } };
  globalThis.URL = {
    createObjectURL: blob => { downloads.push(blob.parts.join('')); return 'blob:scenario'; },
    revokeObjectURL: () => {},
  };
  globalThis.document = {
    body: { appendChild: () => {} },
    createElement: () => {
      const a = { click: () => {}, remove: () => {} };
      anchors.push(a);
      return a;
    },
    getElementById: () => null,
  };
  try {
    const stored = editor.saveAs({ id: 'hugeLab', name: 'Huge Lab' });
    assert.equal(stored, null, 'a save that storage refuses reports failure');
    assert.equal(downloads.length, 1, 'the author leaves with the scenario as a file');
    assert.equal(anchors[0].download, 'hugeLab.scenario-backup.json',
      'the backup is named after the scenario');
    const rescued = JSON.parse(downloads[0]);
    assert.equal(rescued.data.floors.length, 30,
      'the downloaded backup contains the complete world');
    const failure = game.logs.at(-1);
    assert.match(failure.msg, /SAVE FAILED/);
    assert.match(failure.msg, /backup was downloaded/);
    assert.equal(failure.type, 'bad', 'failures go through the game log, not alert()');
  } finally {
    globalThis.Blob = realBlob;
    globalThis.URL = realURL;
    delete globalThis.document;
  }
}

// ------------------- a refused save still banks a recovery draft ------------

{
  // Overwriting the recovery key reuses space a new scenario key cannot claim,
  // so the draft is the author's fallback even when the save itself is refused.
  const storage = memoryStorage();
  const game = stubGame();
  const editor = new ScenarioEditor(game, null, { fresh: true, storage });
  buildWorld(game.state, 25);
  const passThrough = storage.setItem;
  storage.setItem = (key, value) => {
    if (key.startsWith(CUSTOM_SCENARIO_PREFIX)) {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    }
    passThrough.call(storage, key, value);
  };
  // With no document to download through, the editor dumps the payload to the
  // console as the last resort. Capture it rather than flooding the suite.
  const realError = console.error;
  const consoleDumps = [];
  console.error = (...args) => consoleDumps.push(args.join(' '));
  try {
    assert.equal(editor.saveAs({ id: 'refusedLab', name: 'Refused Lab' }), null);
  } finally {
    console.error = realError;
    storage.setItem = passThrough;
  }
  assert.ok(consoleDumps.some(d => /"floors"/.test(d)),
    'with no download available the whole scenario is still put somewhere the author can copy it');

  const draft = JSON.parse(storage.getItem(SCENARIO_RECOVERY_KEY));
  assert.equal(draft.data.floors.length, 25,
    'work that could not be published is still recoverable on the next boot');
  assert.equal(game.logs.filter(l => /SCENARIO AUTOSAVE FAILED/.test(l.msg)).length, 0,
    'the fallback draft write does not add a second, confusing complaint');
  assert.equal(game.logs.filter(l => /SAVE FAILED/.test(l.msg)).length, 1,
    'the author is told once, clearly, that the save did not land');
}

// ---------------------------------------- storage absent entirely -----------

{
  const game = stubGame();
  const editor = new ScenarioEditor(game, null, { fresh: true, storage: null });
  buildWorld(game.state, 4);
  assert.equal(editor.autosaveDraft(), null, 'no storage is not an error, just no draft');
  assert.equal(editor.readRecoveryDraft(), null);
  assert.doesNotThrow(() => editor.clearRecoveryDraft());
  assert.equal(editor.offerRecoveryRestore(), false);
  assert.doesNotThrow(() => editor.stopDraftAutosave());
}

// alert() is not error handling: the editor must not have any left.
{
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/ui/ScenarioEditor.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\balert\s*\(/,
    'storage failures are reported through game.log, never a dead-end alert()');
}

console.log('scenario editor recovery: all assertions passed');
