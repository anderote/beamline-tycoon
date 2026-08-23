// src/game/SaveSlots.js — named save-slot storage (pure logic, no UI).
//
// Storage layout:
//   beamlineTycoon             — the single active autosave (written in place)
//   beamlineTycoon.slotIndex   — JSON array of { id, name, savedAt, meta }
//   beamlineTycoon.slots.<id>  — the serialized payload for that slot
//   beamlineTycoon.autosaves.<id> — retired recovery-copy storage (migration only)
//
// meta is a small summary for the list UI: { funding, staff, components, tick }.
//
// Older builds also created rolling recovery copies. Those looked like extra
// Minor Lab saves in the UI and multiplied very large world payloads. The
// active key already is an overwrite-in-place autosave, so recovery copies are
// now retired and eagerly removed whenever SaveSlots is used.

import {
  getStorage,
  isQuotaError,
  runWithQuotaRecovery,
  safeGetItem,
  safeRemoveItem,
  storageUnits,
} from './storageQuota.js';

const ACTIVE_KEY = 'beamlineTycoon';
const INDEX_KEY = 'beamlineTycoon.slotIndex';
const SLOT_PREFIX = 'beamlineTycoon.slots.';
const AUTOSAVE_PREFIX = 'beamlineTycoon.autosaves.';
// Kept as zero-valued compatibility exports for diagnostics/tests that import
// these names. Automatic history has no retention allowance anymore.
export const AUTOSAVE_LIMIT = 0;
export const AUTOSAVE_BUDGET = 0;

export { ACTIVE_KEY, AUTOSAVE_PREFIX, INDEX_KEY, SLOT_PREFIX };

function readIndex(storage) {
  try {
    const raw = safeGetItem(INDEX_KEY, storage);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

// The index is tiny, but it is written right after a large payload, so it can
// be the write that tips the quota. Losing it orphans every slot, so it gets
// the same eviction-and-retry treatment as a payload.
function writeIndex(index, storage) {
  const store = getStorage(storage);
  if (!store) return false;
  // Serialized per attempt: eviction during recovery removes entries from
  // `index`, and the retry must write the shrunken list, not the stale one.
  const result = runWithQuotaRecovery(() => { store.setItem(INDEX_KEY, JSON.stringify(index)); return true; }, {
    reclaim: () => evictOldestAutosave({ storage: store, protectIndex: index }),
  });
  return result.ok;
}

function autosaveEntries(index) {
  return index.filter(s => s.kind === 'autosave')
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

/**
 * Drop one legacy recovery copy to free space. Named slots, the active save,
 * and scenario payloads are never touched.
 *
 * `except` protects ids (e.g. the snapshot currently being written).
 * Returns true only when real bytes were released, which is what makes the
 * retry loop in runWithQuotaRecovery terminate: an index entry whose payload
 * is already gone frees nothing, so this walks past it to the next-oldest
 * snapshot instead of reporting false progress and being asked again.
 */
export function evictOldestAutosave({ except = [], storage, protectIndex = null } = {}) {
  const store = getStorage(storage);
  if (!store) return false;
  const index = readIndex(store);
  const protectedIds = new Set(except);
  const candidates = autosaveEntries(index).filter(s => !protectedIds.has(s.id));
  const dropped = new Set();
  let freed = false;
  // Oldest first.
  for (let i = candidates.length - 1; i >= 0 && !freed; i--) {
    const victim = candidates[i];
    const key = AUTOSAVE_PREFIX + victim.id;
    freed = safeGetItem(key, store) != null;
    safeRemoveItem(key, store);
    dropped.add(victim.id);
  }
  if (!dropped.size) return false;
  const pruned = index.filter(s => !dropped.has(s.id));
  // Rewrite the index directly: going through writeIndex would recurse into
  // eviction. A failure here is survivable — the payloads are already gone,
  // so the space was freed and the retry is still worth making; the stale
  // entries are dropped by the next successful index write.
  try { store.setItem(INDEX_KEY, JSON.stringify(pruned)); } catch (_) {}
  // Keep an in-flight caller's copy of the index consistent with storage.
  if (Array.isArray(protectIndex)) {
    for (let at = protectIndex.length - 1; at >= 0; at--) {
      if (dropped.has(protectIndex[at].id)) protectIndex.splice(at, 1);
    }
  }
  return freed;
}

/**
 * Remove all indexed legacy recovery copies. This is retained under the old
 * name so callers compiled against earlier versions migrate instead of
 * creating another history.
 */
export function pruneAutosaves(index, storage) {
  const store = getStorage(storage);
  const autosaves = autosaveEntries(index);
  for (const entry of autosaves) safeRemoveItem(AUTOSAVE_PREFIX + entry.id, store);
  return index.filter(entry => entry.kind !== 'autosave');
}

/** Purge historical autosave-copy payloads and remove them from the index. */
export function purgeAutosaveCopies(storage) {
  const store = getStorage(storage);
  if (!store) return [];
  const index = readIndex(store);
  const cleaned = pruneAutosaves(index, store);

  // Also remove orphan payloads left behind by interrupted old index writes.
  const keys = [];
  try {
    if (typeof store.keys === 'function') keys.push(...store.keys());
    else for (let i = 0; i < store.length; i++) keys.push(store.key(i));
  } catch (_) {}
  for (const key of keys) {
    if (typeof key === 'string' && key.startsWith(AUTOSAVE_PREFIX)) safeRemoveItem(key, store);
  }

  if (cleaned.length !== index.length) writeIndex(cleaned, store);
  return cleaned;
}

export const SaveSlots = {
  AUTOSAVE_LIMIT,
  AUTOSAVE_BUDGET,

  // List all slots, newest first: [{ id, name, savedAt, meta }]
  list() {
    return purgeAutosaveCopies().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  },

  // Save payload into slot `id`, or a new slot when id is null/undefined.
  // Returns the slot id, or null when the payload could not be stored — a
  // deliberate save is never silently dropped, so callers must handle null.
  saveTo(id, name, payload, meta = {}) {
    const store = getStorage();
    if (!store) return null;
    const index = purgeAutosaveCopies(store);
    const existing = id != null ? index.find(s => s.id === id) : null;
    const slotId = existing?.id
      ?? (id != null ? id : `slot_${Date.now()}_${Math.floor(Math.random() * 1e4)}`);

    // Write the payload first. Any retired recovery data was purged above,
    // and a failed new save must never leave a dangling index entry.
    const write = runWithQuotaRecovery(() => { store.setItem(SLOT_PREFIX + slotId, payload); return true; }, {
      reclaim: () => evictOldestAutosave({ storage: store }),
    });
    if (!write.ok) return null;

    // Re-read: eviction during recovery rewrote the index underneath us.
    const fresh = readIndex(store);
    let entry = fresh.find(s => s.id === slotId);
    if (!entry) {
      entry = { id: slotId };
      fresh.push(entry);
    }
    entry.name = name || entry.name || 'Unnamed save';
    entry.savedAt = Date.now();
    entry.meta = meta;
    entry.bytes = storageUnits(payload);
    if (!writeIndex(fresh, store)) {
      // Overwriting an existing slot: the payload is written and the slot is
      // still listed from the previous index, so the save is reachable — only
      // its timestamp/summary are stale. Deleting it here would destroy both
      // the new and the previous version.
      if (existing) return slotId;
      // A brand-new slot with no index entry is unreachable; drop the orphan
      // rather than leaking storage the player cannot see or delete.
      safeRemoveItem(SLOT_PREFIX + slotId, store);
      return null;
    }
    return entry.id;
  },

  // Return the payload string for a slot, or null if missing.
  load(id) {
    purgeAutosaveCopies();
    return safeGetItem(SLOT_PREFIX + id);
  },

  // Copy a slot's payload into the ACTIVE key. Returns true on success.
  // Caller is responsible for reloading the page afterwards.
  loadIntoActive(id) {
    const payload = this.load(id);
    if (!payload) return false;
    // Replacing the active save can itself exceed the quota; any remaining
    // retired recovery data is expendable next to the requested game.
    const write = setActiveSave(payload);
    return write.ok;
  },

  remove(id) {
    const index = purgeAutosaveCopies();
    safeRemoveItem(SLOT_PREFIX + id);
    writeIndex(index.filter(s => s.id !== id));
  },

  rename(id, name) {
    const index = purgeAutosaveCopies();
    const entry = index.find(s => s.id === id);
    if (!entry) return false;
    entry.name = name;
    writeIndex(index);
    return true;
  },

  // Compatibility no-op: the active key is the one overwrite-in-place
  // autosave. Calling this only migrates away old recovery copies.
  autosave() {
    purgeAutosaveCopies();
    return null;
  },

  // Compatibility no-op for older scenario-launch callers.
  preserveActive() {
    purgeAutosaveCopies();
    return null;
  },

  // Compatibility diagnostic: retired recovery history always occupies zero.
  autosaveUnits() {
    purgeAutosaveCopies();
    return 0;
  },

  evictOldestAutosave,
  pruneAutosaves,
  purgeAutosaveCopies,
  isQuotaError,
};

/**
 * Write the single ACTIVE autosave in place. Legacy recovery copies may be
 * removed if they are the only thing blocking the write.
 */
export function setActiveSave(payload, storage) {
  const store = getStorage(storage);
  if (!store) {
    return { ok: false, value: null, error: new Error('Storage is unavailable'), reclaimed: 0 };
  }
  // Make the migration immediate on the next normal autosave, even if the
  // player never opens the Load dialog.
  purgeAutosaveCopies(store);
  return runWithQuotaRecovery(() => { store.setItem(ACTIVE_KEY, payload); return true; }, {
    reclaim: () => evictOldestAutosave({ storage: store }),
  });
}
