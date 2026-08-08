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
    return localStorage.getItem(SLOT_PREFIX + id);
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
    localStorage.removeItem(SLOT_PREFIX + id);
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
};
