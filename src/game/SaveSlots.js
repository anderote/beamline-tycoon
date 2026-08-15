// src/game/SaveSlots.js — named save-slot storage (pure logic, no UI).
//
// Storage layout:
//   beamlineTycoon             — ACTIVE/autosave slot (untouched by this module
//                                except via loadIntoActive)
//   beamlineTycoon.slotIndex   — JSON array of { id, name, savedAt, meta }
//   beamlineTycoon.slots.<id>  — the serialized payload for that slot
//
// meta is a small summary for the list UI: { funding, staff, components, tick }.

const ACTIVE_KEY = 'beamlineTycoon';
const INDEX_KEY = 'beamlineTycoon.slotIndex';
const SLOT_PREFIX = 'beamlineTycoon.slots.';
const AUTOSAVE_PREFIX = 'beamlineTycoon.autosaves.';
const AUTOSAVE_LIMIT = 12;
const AUTOSAVE_INTERVAL = 5 * 60 * 1000;

function readIndex() {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function writeIndex(index) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

export const SaveSlots = {
  // List all slots, newest first: [{ id, name, savedAt, meta }]
  list() {
    return readIndex().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  },

  // Save payload into slot `id`, or a new slot when id is null/undefined.
  // Returns the slot id. `meta` is an optional summary object for the list UI.
  saveTo(id, name, payload, meta = {}) {
    const index = readIndex();
    let entry = id != null ? index.find(s => s.id === id) : null;
    if (!entry) {
      entry = { id: id != null ? id : `slot_${Date.now()}_${Math.floor(Math.random() * 1e4)}` };
      index.push(entry);
    }
    entry.name = name || entry.name || 'Unnamed save';
    entry.savedAt = Date.now();
    entry.meta = meta;
    localStorage.setItem(SLOT_PREFIX + entry.id, payload);
    writeIndex(index);
    return entry.id;
  },

  // Return the payload string for a slot, or null if missing.
  load(id) {
    const entry = readIndex().find(s => s.id === id);
    return localStorage.getItem((entry?.kind === 'autosave' ? AUTOSAVE_PREFIX : SLOT_PREFIX) + id);
  },

  // Copy a slot's payload into the ACTIVE key. Returns true on success.
  // Caller is responsible for reloading the page afterwards.
  loadIntoActive(id) {
    const payload = this.load(id);
    if (!payload) return false;
    localStorage.setItem(ACTIVE_KEY, payload);
    return true;
  },

  remove(id) {
    const entry = readIndex().find(s => s.id === id);
    localStorage.removeItem((entry?.kind === 'autosave' ? AUTOSAVE_PREFIX : SLOT_PREFIX) + id);
    writeIndex(readIndex().filter(s => s.id !== id));
  },

  rename(id, name) {
    const index = readIndex();
    const entry = index.find(s => s.id === id);
    if (!entry) return false;
    entry.name = name;
    writeIndex(index);
    return true;
  },

  // Keep a small, time-spaced recovery history in addition to the rolling
  // active save. `force` is used before replacing a game, so even a very new
  // session remains recoverable.
  autosave(payload, meta = {}, { force = false, name = 'Autosave' } = {}) {
    if (!payload) return null;
    const index = readIndex();
    const newest = index
      .filter(s => s.kind === 'autosave')
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))[0];
    const now = Date.now();
    if (!force && newest && now - newest.savedAt < AUTOSAVE_INTERVAL) return newest.id;

    const entry = {
      id: `auto_${now}_${Math.floor(Math.random() * 1e4)}`,
      name,
      kind: 'autosave',
      savedAt: now,
      meta,
    };
    try {
      localStorage.setItem(AUTOSAVE_PREFIX + entry.id, payload);
      index.push(entry);
      const autosaves = index.filter(s => s.kind === 'autosave')
        .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      const expired = autosaves.slice(AUTOSAVE_LIMIT);
      for (const old of expired) localStorage.removeItem(AUTOSAVE_PREFIX + old.id);
      writeIndex(index.filter(s => !expired.some(old => old.id === s.id)));
      return entry.id;
    } catch (_) {
      // The rolling active save remains useful if localStorage is full.
      try { localStorage.removeItem(AUTOSAVE_PREFIX + entry.id); } catch (_) {}
      return null;
    }
  },

  // Snapshot the rolling save before New Game/scenario flows remove it.
  preserveActive(name = 'Previous game') {
    let payload;
    try { payload = localStorage.getItem(ACTIVE_KEY); } catch (_) { return null; }
    if (!payload) return null;
    let meta = {};
    try {
      const state = JSON.parse(payload)?.state || {};
      meta = {
        funding: Math.floor(state.resources?.funding ?? 0),
        staff: (state.staffMembers || []).length,
        components: (state.placeables || []).filter(p => p.category !== 'decoration').length,
        tick: state.tick || 0,
      };
    } catch (_) {}
    return this.autosave(payload, meta, { force: true, name });
  },
};
