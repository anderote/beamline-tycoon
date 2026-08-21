import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: key => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key),
};

const { SaveSlots, AUTOSAVE_LIMIT, AUTOSAVE_BUDGET } = await import('../src/game/SaveSlots.js');
const realNow = Date.now;
let now = 1_000_000;
Date.now = () => now;

try {
  const payload = JSON.stringify({ version: 9, state: {
    resources: { funding: 1234 }, staffMembers: [{ id: 1 }],
    placeables: [{ category: 'equipment' }, { category: 'decoration' }], tick: 30,
  }});

  const first = SaveSlots.autosave(payload, { tick: 30 });
  assert.ok(first);
  now += 60_000;
  assert.equal(SaveSlots.autosave('newer'), first, 'autosaves are time-spaced');
  assert.equal(SaveSlots.list().length, 1);

  localStorage.setItem('beamlineTycoon', payload);
  now += 1;
  const preserved = SaveSlots.preserveActive('Before new game');
  assert.ok(preserved);
  assert.equal(SaveSlots.load(preserved), payload);
  const entry = SaveSlots.list().find(s => s.id === preserved);
  assert.equal(entry.kind, 'autosave');
  assert.equal(entry.name, 'Before new game');
  assert.deepEqual(entry.meta, { funding: 1234, staff: 1, components: 1, tick: 30 });

  SaveSlots.loadIntoActive(first);
  assert.equal(localStorage.getItem('beamlineTycoon'), payload);
  SaveSlots.remove(first);
  assert.equal(SaveSlots.load(first), null);

  for (let i = 0; i < 15; i++) {
    now += 300_001;
    SaveSlots.autosave(`payload-${i}`, { tick: i });
  }
  const bounded = SaveSlots.list().filter(s => s.kind === 'autosave');
  assert.equal(bounded.length, AUTOSAVE_LIMIT,
    'recovery history is bounded by count');
  assert.ok(AUTOSAVE_LIMIT <= 6,
    'a full world snapshot per entry means the count cap must stay small');
  // Orphan check: pruning removes the payloads too, not just index entries.
  assert.equal(
    [...store.keys()].filter(k => k.startsWith('beamlineTycoon.autosaves.')).length,
    AUTOSAVE_LIMIT,
    'evicted snapshots are deleted from storage, not merely unindexed');

  // Retention is ALSO capped by size: a mature world serializes to hundreds
  // of kilobytes, so the count cap alone would still exhaust the origin.
  for (const entry of bounded) SaveSlots.remove(entry.id);
  const big = 'x'.repeat(Math.floor(AUTOSAVE_BUDGET / 2.5));
  for (let i = 0; i < 4; i++) {
    now += 300_001;
    SaveSlots.autosave(big + i, { tick: i });
  }
  const heavy = SaveSlots.list().filter(s => s.kind === 'autosave');
  assert.ok(heavy.length < AUTOSAVE_LIMIT,
    'oversized snapshots are evicted before the count cap is reached');
  assert.ok(SaveSlots.autosaveUnits() <= AUTOSAVE_BUDGET,
    'recovery history stays inside its storage budget');

  // A single snapshot larger than the whole budget is still kept: an
  // oversized world must remain recoverable.
  for (const entry of heavy) SaveSlots.remove(entry.id);
  now += 300_001;
  const huge = SaveSlots.autosave('y'.repeat(AUTOSAVE_BUDGET + 10), { tick: 99 });
  assert.ok(huge);
  assert.equal(SaveSlots.list().filter(s => s.kind === 'autosave').length, 1,
    'the newest snapshot survives even when it alone exceeds the budget');
} finally {
  Date.now = realNow;
}

console.log('save slot recovery tests passed');
