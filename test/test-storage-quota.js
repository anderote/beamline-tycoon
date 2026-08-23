// Quota-aware persistence and the single-overwriting-autosave contract.
import assert from 'node:assert/strict';

function quotaError(kind = 'chrome') {
  if (kind === 'chrome') return new DOMException('quota exceeded', 'QuotaExceededError');
  if (kind === 'firefox') {
    const error = new Error('Persistent storage maximum size reached');
    error.name = 'NS_ERROR_DOM_QUOTA_REACHED';
    error.code = 1014;
    return error;
  }
  const error = new Error('');
  error.code = 22;
  return error;
}

function quotaStorage({ limit = Infinity, errorKind = 'chrome' } = {}) {
  const values = new Map();
  const used = () => [...values.entries()].reduce((total, [key, value]) => (
    total + key.length + value.length
  ), 0);
  return {
    values,
    used,
    get length() { return values.size; },
    key: index => [...values.keys()][index] ?? null,
    keys: () => [...values.keys()],
    setLimit(next) { limit = next; },
    getItem: key => values.get(key) ?? null,
    setItem(key, value) {
      const text = String(value);
      const previous = values.has(key) ? key.length + values.get(key).length : 0;
      if (used() - previous + key.length + text.length > limit) throw quotaError(errorKind);
      values.set(key, text);
    },
    removeItem: key => values.delete(key),
  };
}

const hostileStorage = {
  getItem() { throw new Error('The operation is insecure.'); },
  setItem() { throw new Error('The operation is insecure.'); },
  removeItem() { throw new Error('The operation is insecure.'); },
};

const {
  downloadTextFile,
  isQuotaError,
  runWithQuotaRecovery,
  safeGetItem,
  safeRemoveItem,
  setItemWithRecovery,
  storageUnits,
} = await import('../src/game/storageQuota.js');

for (const kind of ['chrome', 'firefox', 'code22']) {
  assert.equal(isQuotaError(quotaError(kind)), true);
}
assert.equal(isQuotaError(new Error('boom')), false);
assert.equal(storageUnits('abc'), 3);
assert.equal(storageUnits(null), 0);
assert.equal(safeGetItem('anything', hostileStorage), null);
assert.equal(safeRemoveItem('anything', hostileStorage), false);
assert.equal(setItemWithRecovery('k', 'v', { storage: hostileStorage }).ok, false);
assert.equal(downloadTextFile('x.json', 'payload'), false);

{
  let attempts = 0;
  const result = runWithQuotaRecovery(() => {
    attempts++;
    if (attempts < 3) throw quotaError('firefox');
    return 'stored';
  }, { reclaim: () => true });
  assert.equal(result.ok, true);
  assert.equal(result.reclaimed, 2);
}
{
  let reclaims = 0;
  const result = runWithQuotaRecovery(() => { throw quotaError(); }, {
    reclaim: () => { reclaims++; return false; },
  });
  assert.equal(result.ok, false);
  assert.equal(reclaims, 1);
}
{
  let reclaims = 0;
  const result = runWithQuotaRecovery(() => { throw new Error('boom'); }, {
    reclaim: () => { reclaims++; return true; },
  });
  assert.equal(result.ok, false);
  assert.equal(reclaims, 0);
}

const {
  ACTIVE_KEY,
  AUTOSAVE_PREFIX,
  INDEX_KEY,
  SLOT_PREFIX,
  SaveSlots,
  setActiveSave,
} = await import('../src/game/SaveSlots.js');

function useStorage(storage) {
  globalThis.localStorage = storage;
  return storage;
}

function seedLegacyCopies(storage, count, size = 600) {
  const index = [];
  for (let i = 0; i < count; i++) {
    const id = `legacy_${i}`;
    storage.setItem(AUTOSAVE_PREFIX + id, String(i).repeat(size));
    index.push({ id, name: 'Minor Lab', kind: 'autosave', savedAt: i + 1 });
  }
  storage.setItem(INDEX_KEY, JSON.stringify(index));
}

// Opening/using SaveSlots migrates old recovery histories away completely.
{
  const storage = useStorage(quotaStorage());
  seedLegacyCopies(storage, 4);
  assert.deepEqual(SaveSlots.list(), []);
  assert.equal(storage.keys().some(key => key.startsWith(AUTOSAVE_PREFIX)), false);
  assert.deepEqual(JSON.parse(storage.getItem(INDEX_KEY)), []);
}

// The next active write eagerly reclaims retired recovery data before it can
// compete with the one current autosave.
{
  const storage = useStorage(quotaStorage({ limit: 5000 }));
  seedLegacyCopies(storage, 4, 700);
  const result = setActiveSave('active'.repeat(500));
  assert.equal(result.ok, true);
  assert.equal(storage.getItem(ACTIVE_KEY), 'active'.repeat(500));
  assert.equal(storage.keys().some(key => key.startsWith(AUTOSAVE_PREFIX)), false);
}

// Named saves remain intentional independent records and never disappear on
// quota failure. Unstorable new payloads do not leave orphan keys or entries.
{
  const storage = useStorage(quotaStorage({ limit: 6000 }));
  const keeper = SaveSlots.saveTo(null, 'Keep me', 'k'.repeat(500), { tick: 1 });
  assert.ok(keeper);
  const impossible = SaveSlots.saveTo(null, 'Too big', 'x'.repeat(20_000), { tick: 2 });
  assert.equal(impossible, null);
  assert.equal(SaveSlots.load(keeper), 'k'.repeat(500));
  assert.equal(storage.keys().filter(key => key.startsWith(SLOT_PREFIX)).length, 1);
  assert.equal(SaveSlots.list().length, 1);
}

// Overwriting a named slot keeps it reachable even if its metadata/index
// refresh is the write that runs out of space.
{
  const storage = useStorage(quotaStorage({ limit: 6000 }));
  const slot = SaveSlots.saveTo(null, 'Checkpoint', 'v1-'.repeat(100), { tick: 1 });
  const normalSet = storage.setItem;
  storage.setItem = (key, value) => {
    if (key === INDEX_KEY) throw quotaError();
    normalSet.call(storage, key, value);
  };
  assert.equal(SaveSlots.saveTo(slot, 'Checkpoint', 'v2-'.repeat(100), { tick: 2 }), slot);
  storage.setItem = normalSet;
  assert.match(SaveSlots.load(slot), /^v2-/);
}

// Every public path degrades cleanly when storage is unavailable.
{
  useStorage(hostileStorage);
  assert.deepEqual(SaveSlots.list(), []);
  assert.equal(SaveSlots.saveTo(null, 'x', 'payload'), null);
  assert.equal(SaveSlots.autosave('payload'), null);
  assert.equal(SaveSlots.preserveActive(), null);
  assert.equal(SaveSlots.load('nope'), null);
  assert.equal(SaveSlots.loadIntoActive('nope'), false);
  assert.equal(SaveSlots.autosaveUnits(), 0);
  globalThis.localStorage = undefined;
  assert.equal(setActiveSave('payload').ok, false);
}

// The live game writes one stable active autosave and creates no history.
{
  const { Game } = await import('../src/game/Game.js');
  const { BeamlineRegistry } = await import('../src/beamline/BeamlineRegistry.js');
  const storage = useStorage(quotaStorage());
  const game = new Game(new BeamlineRegistry(), { seed: 4242 });
  const logs = [];
  game.log = (message, type = '') => logs.push({ message, type });
  game.save();
  const first = storage.getItem(ACTIVE_KEY);
  game.state.tick++;
  game.save();
  assert.notEqual(storage.getItem(ACTIVE_KEY), first,
    'the active autosave is overwritten with the latest state');
  assert.equal(storage.keys().filter(key => key.startsWith(AUTOSAVE_PREFIX)).length, 0,
    'normal autosave never creates recovery copies');
  assert.equal(storage.keys().filter(key => key === ACTIVE_KEY).length, 1);

  useStorage(hostileStorage);
  game.save();
  game.save();
  assert.equal(logs.filter(entry => /AUTOSAVE FAILED/.test(entry.message)).length, 1,
    'a persistent failure is reported once');
}

globalThis.localStorage = undefined;
console.log('storage quota and single-autosave tests passed');
