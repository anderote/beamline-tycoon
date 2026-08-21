// src/game/SaveSlots.js — named save-slot storage (pure logic, no UI).
//
// Storage layout:
//   beamlineTycoon             — ACTIVE/autosave slot (untouched by this module
//                                except via loadIntoActive)
//   beamlineTycoon.slotIndex   — JSON array of { id, name, savedAt, meta }
//   beamlineTycoon.slots.<id>  — the serialized payload for that slot
//   beamlineTycoon.autosaves.<id> — a rolling recovery snapshot
//
// meta is a small summary for the list UI: { funding, staff, components, tick }.
//
// RETENTION. Recovery autosaves are the only thing in this module that grows
// on its own, so they are the only thing allowed to be evicted. They are
// bounded twice: by count (AUTOSAVE_LIMIT) and by total size
// (AUTOSAVE_BUDGET). A mature world serializes to hundreds of kilobytes, so a
// count-only cap is not a cap at all — it let recovery history monopolise the
// origin quota and starve deliberate saves and authored scenarios.
// The newest snapshot is always kept, even when it alone exceeds the budget.

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
// Six snapshots at AUTOSAVE_INTERVAL spacing is ~30 minutes of undoable
// history. The count cap governs small worlds (where six snapshots are
// nothing); on a large world the byte budget below bites first, so this is a
// clutter bound, not the real protection.
export const AUTOSAVE_LIMIT = 6;
// UTF-16 code units (see storageUnits). Browsers budget localStorage by
// UTF-16 storage size, so a nominal "5MB" origin is only ~2.6M units of text.
// Measured (test/test-storage-quota.js): even a BLANK game serializes to
// ~370k units, so the old cap of twelve reserved ~4.5M units — nearly twice
// the whole origin — which is how a 450k-unit scenario ended up with nowhere
// to go. 1.2M units is under half the origin: about three snapshots of a
// typical save, or two of a large one, alongside the active save, the named
// slots, and an authored scenario. Anything above that is evicted, and the
// whole budget is surrendered on demand when a real save needs the room.
export const AUTOSAVE_BUDGET = 1_200_000;
const AUTOSAVE_INTERVAL = 5 * 60 * 1000;

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

// Prefer the size recorded at write time; fall back to measuring the payload
// for entries written before sizes were tracked.
function entryUnits(entry, storage) {
  if (Number.isFinite(entry.bytes)) return entry.bytes;
  return storageUnits(safeGetItem(AUTOSAVE_PREFIX + entry.id, storage));
}

/**
 * Drop the oldest recovery autosave to free space. Named slots, the active
 * save, and scenario payloads are never touched — this is the only eviction
 * primitive in the codebase and it can only see autosaves.
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
 * Apply the count + size retention policy. Returns the index with expired
 * autosave entries removed; their payloads are deleted from storage.
 */
export function pruneAutosaves(index, storage) {
  const store = getStorage(storage);
  const autosaves = autosaveEntries(index);
  const expired = [];
  let kept = 0;
  let units = 0;
  for (const entry of autosaves) {
    const size = entryUnits(entry, store);
    // The newest snapshot is always retained: an oversized world must still
    // be recoverable, and it was just written successfully.
    const withinCount = kept < AUTOSAVE_LIMIT;
    const withinBudget = kept === 0 || units + size <= AUTOSAVE_BUDGET;
    if (withinCount && withinBudget) {
      kept++;
      units += size;
    } else {
      expired.push(entry);
    }
  }
  for (const old of expired) safeRemoveItem(AUTOSAVE_PREFIX + old.id, store);
  return index.filter(s => !expired.some(old => old.id === s.id));
}

export const SaveSlots = {
  AUTOSAVE_LIMIT,
  AUTOSAVE_BUDGET,

  // List all slots, newest first: [{ id, name, savedAt, meta }]
  list() {
    return readIndex().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  },

  // Save payload into slot `id`, or a new slot when id is null/undefined.
  // Returns the slot id, or null when the payload could not be stored — a
  // deliberate save is never silently dropped, so callers must handle null.
  saveTo(id, name, payload, meta = {}) {
    const store = getStorage();
    if (!store) return null;
    const index = readIndex(store);
    const existing = id != null ? index.find(s => s.id === id) : null;
    const slotId = existing?.id
      ?? (id != null ? id : `slot_${Date.now()}_${Math.floor(Math.random() * 1e4)}`);

    // Write the payload first: a named save outranks recovery autosaves, so
    // it may evict them, but it must never leave a dangling index entry.
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
    const entry = readIndex().find(s => s.id === id);
    return safeGetItem((entry?.kind === 'autosave' ? AUTOSAVE_PREFIX : SLOT_PREFIX) + id);
  },

  // Copy a slot's payload into the ACTIVE key. Returns true on success.
  // Caller is responsible for reloading the page afterwards.
  loadIntoActive(id) {
    const payload = this.load(id);
    if (!payload) return false;
    // Replacing the active save can itself exceed the quota; recovery
    // autosaves are expendable next to the game the player asked to load.
    const write = setActiveSave(payload);
    return write.ok;
  },

  remove(id) {
    const index = readIndex();
    const entry = index.find(s => s.id === id);
    safeRemoveItem((entry?.kind === 'autosave' ? AUTOSAVE_PREFIX : SLOT_PREFIX) + id);
    writeIndex(index.filter(s => s.id !== id));
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
    const store = getStorage();
    if (!store) return null;
    const newest = autosaveEntries(readIndex(store))[0];
    const now = Date.now();
    if (!force && newest && now - newest.savedAt < AUTOSAVE_INTERVAL) return newest.id;

    const entry = {
      id: `auto_${now}_${Math.floor(Math.random() * 1e4)}`,
      name,
      kind: 'autosave',
      savedAt: now,
      meta,
      bytes: storageUnits(payload),
    };
    const write = runWithQuotaRecovery(() => { store.setItem(AUTOSAVE_PREFIX + entry.id, payload); return true; }, {
      // Older snapshots make way for the newest one; nothing else is touched.
      reclaim: () => evictOldestAutosave({ except: [entry.id], storage: store }),
    });
    if (!write.ok) {
      // The rolling active save remains useful if localStorage is full.
      safeRemoveItem(AUTOSAVE_PREFIX + entry.id, store);
      return null;
    }
    const index = readIndex(store);
    index.push(entry);
    if (!writeIndex(pruneAutosaves(index, store), store)) {
      safeRemoveItem(AUTOSAVE_PREFIX + entry.id, store);
      return null;
    }
    return entry.id;
  },

  // Snapshot the rolling save before New Game/scenario flows remove it.
  preserveActive(name = 'Previous game') {
    const payload = safeGetItem(ACTIVE_KEY);
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

  // Total UTF-16 units currently held by recovery autosaves. Exposed for
  // diagnostics and retention tests.
  autosaveUnits() {
    const store = getStorage();
    return autosaveEntries(readIndex(store)).reduce((sum, e) => sum + entryUnits(e, store), 0);
  },

  evictOldestAutosave,
  pruneAutosaves,
  isQuotaError,
};

/**
 * Write the ACTIVE save, evicting recovery autosaves if the quota blocks it.
 * The active save is the game in progress: it outranks every snapshot.
 */
export function setActiveSave(payload, storage) {
  const store = getStorage(storage);
  if (!store) {
    return { ok: false, value: null, error: new Error('Storage is unavailable'), reclaimed: 0 };
  }
  return runWithQuotaRecovery(() => { store.setItem(ACTIVE_KEY, payload); return true; }, {
    reclaim: () => evictOldestAutosave({ storage: store }),
  });
}
