import assert from 'node:assert/strict';

const values = new Map();
globalThis.localStorage = {
  get length() { return values.size; },
  key: index => [...values.keys()][index] ?? null,
  keys: () => [...values.keys()],
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: key => values.delete(key),
};

const {
  ACTIVE_KEY,
  AUTOSAVE_BUDGET,
  AUTOSAVE_LIMIT,
  AUTOSAVE_PREFIX,
  INDEX_KEY,
  SLOT_PREFIX,
  SaveSlots,
  setActiveSave,
} = await import('../src/game/SaveSlots.js');

assert.equal(AUTOSAVE_LIMIT, 0);
assert.equal(AUTOSAVE_BUDGET, 0,
  'automatic recovery-copy history has no retention allowance');

// Upgrade migration: recovery cards and their payloads disappear, while an
// intentional named save remains loadable. Orphaned recovery payloads are
// removed too, so old copies do not continue consuming browser storage.
values.set(AUTOSAVE_PREFIX + 'old', 'old Minor Lab');
values.set(AUTOSAVE_PREFIX + 'new', 'new Minor Lab');
values.set(AUTOSAVE_PREFIX + 'orphan', 'orphan Minor Lab');
values.set(SLOT_PREFIX + 'named', 'named payload');
values.set(INDEX_KEY, JSON.stringify([
  { id: 'old', name: 'Minor Lab', kind: 'autosave', savedAt: 10 },
  { id: 'new', name: 'Before Minor Lab', kind: 'autosave', savedAt: 20 },
  { id: 'named', name: 'My checkpoint', savedAt: 15 },
]));

assert.deepEqual(SaveSlots.list().map(entry => entry.id), ['named'],
  'the load catalogue exposes only deliberate named saves');
assert.equal(SaveSlots.load('named'), 'named payload');
assert.equal([...values.keys()].some(key => key.startsWith(AUTOSAVE_PREFIX)), false,
  'all indexed and orphaned legacy recovery-copy payloads are purged');

// Compatibility calls from stale code never create another copy.
values.set(ACTIVE_KEY, 'active v1');
assert.equal(SaveSlots.autosave('copy payload'), null);
assert.equal(SaveSlots.preserveActive('Before Minor Lab'), null);
assert.equal([...values.keys()].some(key => key.startsWith(AUTOSAVE_PREFIX)), false);
assert.equal(SaveSlots.autosaveUnits(), 0);

// The actual autosave is a single stable key and every write replaces it.
assert.equal(setActiveSave('active v2').ok, true);
assert.equal(setActiveSave('active v3').ok, true);
assert.equal(values.get(ACTIVE_KEY), 'active v3');
assert.equal([...values.keys()].filter(key => key === ACTIVE_KEY).length, 1);

// Deliberate named saves retain their existing overwrite behavior.
const slot = SaveSlots.saveTo(null, 'Checkpoint', 'checkpoint v1', { tick: 1 });
assert.ok(slot);
assert.equal(SaveSlots.saveTo(slot, 'Checkpoint', 'checkpoint v2', { tick: 2 }), slot);
assert.equal(SaveSlots.load(slot), 'checkpoint v2');
assert.equal(SaveSlots.list().filter(entry => entry.id === slot).length, 1);

console.log('single autosave and named save-slot tests passed');
