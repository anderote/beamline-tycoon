import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: key => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key),
};

const { SaveSlots } = await import('../src/game/SaveSlots.js');
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
  assert.equal(SaveSlots.list().filter(s => s.kind === 'autosave').length, 12,
    'recovery history is bounded');
} finally {
  Date.now = realNow;
}

console.log('save slot recovery tests passed');
