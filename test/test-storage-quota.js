// Quota-aware persistence: detection, eviction, retry, and what is off-limits.
//
// The scenario this suite exists for: an author with hours of unsaved work
// pressed Save, twelve full world snapshots had already eaten the origin, and
// the save was refused with nothing offered in return. Every assertion below
// is one link in that chain.
//
// The storage double throws past a byte budget it controls, so nothing here
// depends on a real browser quota.
import assert from 'node:assert/strict';

// ---------------------------------------------------------------- doubles --

function quotaError(kind = 'chrome') {
  if (kind === 'chrome') return new DOMException('quota exceeded', 'QuotaExceededError');
  if (kind === 'firefox') {
    const err = new Error('Persistent storage maximum size reached');
    err.name = 'NS_ERROR_DOM_QUOTA_REACHED';
    err.code = 1014;
    return err;
  }
  if (kind === 'code22') {
    // Old WebKit reports only the numeric code on a plain error object.
    const err = new Error('');
    err.code = 22;
    return err;
  }
  throw new Error(`unknown quota error kind ${kind}`);
}

/**
 * localStorage double with a hard budget, measured the way browsers measure:
 * key length + value length in UTF-16 units, summed over every entry.
 */
function quotaStorage({ limit = Infinity, errorKind = 'chrome' } = {}) {
  const values = new Map();
  const used = () => [...values.entries()].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    values,
    used,
    setLimit(next) { limit = next; },
    keys: () => [...values.keys()],
    getItem: key => (values.has(key) ? values.get(key) : null),
    setItem(key, value) {
      const text = String(value);
      const previous = values.has(key) ? key.length + values.get(key).length : 0;
      if (used() - previous + key.length + text.length > limit) throw quotaError(errorKind);
      values.set(key, text);
    },
    removeItem(key) { values.delete(key); },
  };
}

/** A browser that refuses storage entirely (privacy mode / disabled cookies). */
const hostileStorage = {
  getItem() { throw new Error('The operation is insecure.'); },
  setItem() { throw new Error('The operation is insecure.'); },
  removeItem() { throw new Error('The operation is insecure.'); },
};

const {
  isQuotaError, storageUnits, safeGetItem, safeRemoveItem,
  runWithQuotaRecovery, setItemWithRecovery, downloadTextFile,
} = await import('../src/game/storageQuota.js');

// ------------------------------------------------------------- detection --

for (const kind of ['chrome', 'firefox', 'code22']) {
  assert.equal(isQuotaError(quotaError(kind)), true,
    `a full quota is recognised in its ${kind} shape`);
}
assert.equal(isQuotaError(new Error('boom')), false,
  'an unrelated failure must not trigger eviction of the player\'s history');
assert.equal(isQuotaError(new TypeError('cannot read properties of null')), false);
assert.equal(isQuotaError(null), false);
assert.equal(storageUnits('abc'), 3);
assert.equal(storageUnits(null), 0);

// ---------------------------------------------------- unavailable storage --

assert.equal(safeGetItem('anything', hostileStorage), null,
  'a browser that refuses storage reads as empty instead of throwing');
assert.equal(safeRemoveItem('anything', hostileStorage), false);
assert.equal(setItemWithRecovery('k', 'v', { storage: hostileStorage }).ok, false,
  'a refused write reports failure rather than throwing');
assert.equal(downloadTextFile('x.json', 'payload'), false,
  'without a document the download politely declines');

// ------------------------------------------------------- retry semantics --

{
  let attempts = 0;
  const result = runWithQuotaRecovery(() => {
    attempts++;
    if (attempts < 3) throw quotaError('firefox');
    return 'stored';
  }, { reclaim: () => true });
  assert.equal(result.ok, true);
  assert.equal(result.value, 'stored');
  assert.equal(result.reclaimed, 2, 'each retry follows exactly one reclaim');
}
{
  // Nothing left to free: give up rather than spin.
  let reclaims = 0;
  const result = runWithQuotaRecovery(() => { throw quotaError(); }, {
    reclaim: () => { reclaims++; return false; },
  });
  assert.equal(result.ok, false);
  assert.equal(reclaims, 1, 'a reclaim that frees nothing ends the retry loop');
  assert.equal(isQuotaError(result.error), true, 'the original quota error is preserved');
}
{
  // A non-quota failure is never "recovered" by deleting the player's saves.
  let reclaims = 0;
  const result = runWithQuotaRecovery(() => { throw new Error('serialize blew up'); }, {
    reclaim: () => { reclaims++; return true; },
  });
  assert.equal(result.ok, false);
  assert.equal(reclaims, 0, 'only a quota failure may evict anything');
}

// ------------------------------------------------- SaveSlots under a quota --

const {
  SaveSlots, setActiveSave, evictOldestAutosave, pruneAutosaves,
  AUTOSAVE_LIMIT, AUTOSAVE_BUDGET, ACTIVE_KEY, AUTOSAVE_PREFIX, SLOT_PREFIX, INDEX_KEY,
} = await import('../src/game/SaveSlots.js');
const { CUSTOM_SCENARIO_PREFIX, saveCustomScenario } = await import('../src/data/scenarios.js');

assert.ok(AUTOSAVE_LIMIT <= 6,
  'each autosave is a COMPLETE world snapshot; the count cap must stay small');
assert.ok(AUTOSAVE_BUDGET <= 1_200_000,
  'recovery history must not be able to claim most of a ~2.6M-unit origin');

const realNow = Date.now;
let now = 5_000_000;
Date.now = () => now;
const AUTOSAVE_SPACING = 300_001;

function useStorage(storage) {
  globalThis.localStorage = storage;
  return storage;
}

function autosaveIds(storage) {
  return storage.keys().filter(k => k.startsWith(AUTOSAVE_PREFIX));
}

try {
  // --- A full origin evicts the OLDEST autosave and retries the write. -----
  {
    const store = useStorage(quotaStorage({ limit: 4000 }));
    const snapshot = 'w'.repeat(600);
    for (let i = 0; i < 4; i++) {
      now += AUTOSAVE_SPACING;
      assert.ok(SaveSlots.autosave(snapshot + i, { tick: i }), `autosave ${i} stored`);
    }
    const before = autosaveIds(store).length;
    assert.ok(before >= 2, 'several snapshots fit before the origin fills');

    // Now write one that cannot fit until something is evicted.
    now += AUTOSAVE_SPACING;
    const id = SaveSlots.autosave('n'.repeat(1800), { tick: 99 });
    assert.ok(id, 'a quota failure is recovered by eviction, not surfaced as a lost save');
    assert.equal(SaveSlots.load(id).length, 1800, 'the newest snapshot is stored in full');
    const listed = SaveSlots.list().filter(s => s.kind === 'autosave').map(s => s.id);
    assert.deepEqual(autosaveIds(store).map(k => k.slice(AUTOSAVE_PREFIX.length)).sort(), [...listed].sort(),
      'eviction keeps the index and the stored payloads in agreement');
    assert.equal(listed[0], id, 'the newest snapshot survives');
  }

  // --- Eviction is only ever allowed to consume recovery autosaves. -------
  {
    const store = useStorage(quotaStorage({ limit: 100_000 }));
    store.setItem(ACTIVE_KEY, 'ACTIVE-GAME-IN-PROGRESS');
    saveCustomScenario({
      id: 'majorLab', name: 'Major Lab', data: { floors: ['x'.repeat(400)] },
    }, { storage: store });
    const scenarioKeysBefore = store.keys().filter(k => k.startsWith(CUSTOM_SCENARIO_PREFIX));
    assert.equal(scenarioKeysBefore.length, 1);

    const keeperA = SaveSlots.saveTo(null, 'Before the rebuild', 'k'.repeat(900), { tick: 1 });
    const keeperB = SaveSlots.saveTo(null, 'Beamline complete', 'k'.repeat(900), { tick: 2 });
    assert.ok(keeperA && keeperB);
    for (let i = 0; i < 4; i++) {
      now += AUTOSAVE_SPACING;
      SaveSlots.autosave('a'.repeat(900), { tick: 10 + i });
    }
    const autosavesBefore = autosaveIds(store).length;
    assert.ok(autosavesBefore >= 3);

    // Squeeze the origin down to just above what the protected data occupies,
    // then demand a big named save. Only autosaves may be sacrificed for it.
    const protectedUnits = store.keys()
      .filter(k => !k.startsWith(AUTOSAVE_PREFIX))
      .reduce((n, k) => n + k.length + store.getItem(k).length, 0);
    store.setLimit(protectedUnits + 2600);
    const rescued = SaveSlots.saveTo(null, 'Major Lab checkpoint', 'z'.repeat(1800), { tick: 20 });
    assert.ok(rescued, 'a deliberate save outranks recovery history and gets its space');

    assert.ok(autosaveIds(store).length < autosavesBefore,
      'the oldest recovery snapshots were the ones released');
    assert.equal(store.getItem(ACTIVE_KEY), 'ACTIVE-GAME-IN-PROGRESS',
      'the active save is never evicted');
    assert.deepEqual(store.keys().filter(k => k.startsWith(CUSTOM_SCENARIO_PREFIX)), scenarioKeysBefore,
      'authored scenarios are never evicted');
    assert.equal(SaveSlots.load(keeperA).length, 900, 'named slots are never evicted');
    assert.equal(SaveSlots.load(keeperB).length, 900, 'named slots are never evicted');
    for (const id of [keeperA, keeperB, rescued]) {
      assert.ok(SaveSlots.list().some(s => s.id === id && s.kind !== 'autosave'),
        'every named slot is still listed after eviction');
    }
  }

  // --- Ultimate failure: report it, lose nothing that was already stored. --
  {
    const store = useStorage(quotaStorage({ limit: 6000 }));
    const keeper = SaveSlots.saveTo(null, 'Keep me', 'k'.repeat(500), { tick: 1 });
    now += AUTOSAVE_SPACING;
    SaveSlots.autosave('a'.repeat(500), { tick: 2 });

    // Larger than the whole origin: no amount of eviction can make it fit.
    const impossible = SaveSlots.saveTo(null, 'Too big', 'x'.repeat(20_000), { tick: 3 });
    assert.equal(impossible, null,
      'an impossible save reports failure instead of pretending to have worked');
    assert.equal(SaveSlots.load(keeper).length, 500,
      'a failed save never takes an existing named slot down with it');
    assert.equal(store.keys().filter(k => k.startsWith(SLOT_PREFIX)).length, 1,
      'the unstorable payload leaves no orphan behind');
    assert.equal(SaveSlots.list().filter(s => s.kind !== 'autosave').length, 1,
      'the index gains no entry for a save that was never stored');

    // The active save is likewise reported, not thrown.
    const active = setActiveSave('y'.repeat(20_000));
    assert.equal(active.ok, false);
    assert.equal(isQuotaError(active.error), true);
  }

  // --- Overwriting a named slot never destroys the previous copy. ---------
  {
    const store = useStorage(quotaStorage({ limit: 6000 }));
    const slot = SaveSlots.saveTo(null, 'Rolling checkpoint', 'v1-'.repeat(100), { tick: 1 });
    const failIndexWrites = store.setItem;
    store.setItem = (key, value) => {
      if (key === INDEX_KEY) throw quotaError();
      failIndexWrites.call(store, key, value);
    };
    const again = SaveSlots.saveTo(slot, 'Rolling checkpoint', 'v2-'.repeat(100), { tick: 2 });
    store.setItem = failIndexWrites;
    assert.equal(again, slot, 'the overwrite is reachable through the existing index entry');
    assert.match(SaveSlots.load(slot), /^v2-/, 'the newer payload is what loads');
    assert.ok(SaveSlots.list().some(s => s.id === slot), 'the slot is still listed');
  }

  // --- Retention: count budget and byte budget, independently. ------------
  {
    const store = useStorage(quotaStorage());
    for (let i = 0; i < AUTOSAVE_LIMIT + 8; i++) {
      now += AUTOSAVE_SPACING;
      SaveSlots.autosave(`tiny-${i}`, { tick: i });
    }
    assert.equal(SaveSlots.list().filter(s => s.kind === 'autosave').length, AUTOSAVE_LIMIT,
      'small worlds are bounded by the count budget');
    assert.equal(autosaveIds(store).length, AUTOSAVE_LIMIT,
      'evicted snapshots are deleted from storage, not merely unindexed');
  }
  {
    const store = useStorage(quotaStorage());
    const heavy = 'h'.repeat(Math.floor(AUTOSAVE_BUDGET / 3));
    for (let i = 0; i < AUTOSAVE_LIMIT; i++) {
      now += AUTOSAVE_SPACING;
      SaveSlots.autosave(heavy + i, { tick: i });
    }
    const kept = SaveSlots.list().filter(s => s.kind === 'autosave');
    assert.ok(kept.length < AUTOSAVE_LIMIT,
      'large worlds hit the byte budget before the count budget');
    assert.ok(SaveSlots.autosaveUnits() <= AUTOSAVE_BUDGET,
      'recovery history stays inside its storage budget');
    assert.equal(autosaveIds(store).length, kept.length,
      'byte-budget pruning deletes payloads too');
  }
  {
    // A single world bigger than the entire budget must still be recoverable.
    const store = useStorage(quotaStorage());
    now += AUTOSAVE_SPACING;
    const id = SaveSlots.autosave('g'.repeat(AUTOSAVE_BUDGET + 500), { tick: 1 });
    assert.ok(id);
    assert.equal(autosaveIds(store).length, 1,
      'the newest snapshot survives even when it alone exceeds the budget');
  }

  // --- The eviction primitive itself. -------------------------------------
  {
    const store = useStorage(quotaStorage());
    const named = SaveSlots.saveTo(null, 'Named', 'named-payload', { tick: 1 });
    const ids = [];
    for (let i = 0; i < 3; i++) {
      now += AUTOSAVE_SPACING;
      ids.push(SaveSlots.autosave(`snap-${i}`, { tick: i }));
    }
    const oldest = ids[0];
    assert.equal(evictOldestAutosave({ storage: store }), true);
    assert.equal(store.getItem(AUTOSAVE_PREFIX + oldest), null, 'the oldest went first');
    assert.equal(SaveSlots.list().some(s => s.id === oldest), false,
      'the index no longer advertises an evicted snapshot');

    assert.equal(evictOldestAutosave({ storage: store, except: [ids[1], ids[2]] }), false,
      'protected ids are not eligible victims');
    assert.equal(evictOldestAutosave({ storage: store }), true);
    assert.equal(evictOldestAutosave({ storage: store }), true);
    assert.equal(evictOldestAutosave({ storage: store }), false,
      'with no autosaves left, eviction reports that it freed nothing');
    assert.equal(SaveSlots.load(named), 'named-payload',
      'exhausting recovery history never reaches a named slot');
    assert.equal(evictOldestAutosave({ storage: null }), false,
      'eviction on unavailable storage is a no-op, not a crash');
  }

  // --- Every SaveSlots path survives storage being unavailable. -----------
  {
    useStorage(hostileStorage);
    assert.deepEqual(SaveSlots.list(), []);
    assert.equal(SaveSlots.saveTo(null, 'x', 'payload'), null);
    assert.equal(SaveSlots.autosave('payload'), null);
    assert.equal(SaveSlots.load('nope'), null);
    assert.equal(SaveSlots.loadIntoActive('nope'), false);
    assert.doesNotThrow(() => SaveSlots.remove('nope'));
    assert.equal(SaveSlots.preserveActive(), null);
    assert.equal(SaveSlots.autosaveUnits(), 0);
    assert.deepEqual(pruneAutosaves([], hostileStorage), []);

    // Not `delete`: Node exposes a native localStorage behind the deleted
    // property, and the point here is "no storage object at all".
    globalThis.localStorage = undefined;
    assert.deepEqual(SaveSlots.list(), []);
    assert.equal(SaveSlots.autosave('payload'), null);
    assert.equal(setActiveSave('payload').ok, false);
  }
} finally {
  Date.now = realNow;
  globalThis.localStorage = undefined;
}

// ------------------------------------- the live game's own save path -------

{
  const { Game } = await import('../src/game/Game.js');
  const { BeamlineRegistry } = await import('../src/beamline/BeamlineRegistry.js');

  const realNow2 = Date.now;
  let clock = 9_000_000;
  Date.now = () => clock;
  try {
    // A full origin: the game in progress is written, and its own older
    // recovery snapshots are what pays for the space.
    const store = useStorage(quotaStorage());
    const game = new Game(new BeamlineRegistry(), { seed: 4242 });
    const logs = [];
    game.log = (msg, type = '') => logs.push({ msg, type });

    game.save();
    assert.ok(store.getItem(ACTIVE_KEY), 'the active save is written');
    const snapshotUnits = store.getItem(ACTIVE_KEY).length;
    const autosavesAfterFirst = autosaveIds(store).length;
    assert.equal(autosavesAfterFirst, 1, 'the first save also banks a recovery snapshot');

    for (let i = 0; i < 3; i++) {
      clock += AUTOSAVE_SPACING;
      game.save();
    }
    const banked = autosaveIds(store).length;
    assert.ok(banked >= 2, 'recovery history accumulates while there is room');
    assert.ok(SaveSlots.autosaveUnits() <= AUTOSAVE_BUDGET,
      'a real game\'s history obeys the byte budget');
    // The root cause of the incident, pinned: a world snapshot is enormous
    // even before anything is built, so twelve of them could never fit.
    assert.ok(snapshotUnits > 100_000,
      'a world snapshot is hundreds of kilobytes — retention must be measured, not counted');
    assert.ok(snapshotUnits * 12 > 2_600_000,
      'twelve snapshots would exceed an entire browser origin');

    // Squeeze the origin to roughly the active save plus one snapshot.
    const overhead = store.used() - autosaveIds(store).reduce(
      (n, k) => n + k.length + store.getItem(k).length, 0);
    store.setLimit(overhead + snapshotUnits + 400);
    clock += AUTOSAVE_SPACING;
    game.save();
    assert.ok(store.getItem(ACTIVE_KEY), 'the active save survives a full origin');
    assert.ok(autosaveIds(store).length < banked,
      'older recovery snapshots are evicted to keep the game in progress saved');
    assert.equal(logs.filter(l => /AUTOSAVE FAILED/.test(l.msg)).length, 0,
      'a recovered quota failure is not reported as a failure');

    // Storage that refuses everything: told once, through the game log.
    useStorage(hostileStorage);
    game.save();
    game.save();
    game.save();
    const failures = logs.filter(l => /AUTOSAVE FAILED/.test(l.msg));
    assert.equal(failures.length, 1,
      'a persistent storage failure is reported once, not every tick');
    assert.equal(failures[0].type, 'bad');

    // Headless drivers have no storage at all and never asked for any.
    globalThis.localStorage = undefined;
    const headless = new Game(new BeamlineRegistry(), { seed: 4243 });
    const headlessLogs = [];
    headless.log = (msg, type = '') => headlessLogs.push({ msg, type });
    assert.doesNotThrow(() => headless.save());
    assert.equal(headlessLogs.length, 0,
      'a Node driver with no localStorage is not nagged about persistence');
  } finally {
    Date.now = realNow2;
    globalThis.localStorage = undefined;
  }
}

console.log('storage quota recovery: all assertions passed');
