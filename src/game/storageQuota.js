// src/game/storageQuota.js — quota-aware localStorage helpers (pure logic, no UI).
//
// Every persistence path in the game funnels through here so that a full
// origin quota degrades into "evict recovery autosaves and retry", and — when
// even that is not enough — into a file the player can keep, instead of an
// alert() that leaves hours of work trapped in a page that cannot persist.
//
// Storage may also be entirely unavailable (privacy mode, disabled cookies,
// headless Node drivers). Nothing here throws for that reason: reads return
// null and writes report `{ ok: false }`.

// Browsers disagree on how a full quota is reported:
//   Chrome/Edge/Safari  DOMException name 'QuotaExceededError', code 22
//   Firefox             'NS_ERROR_DOM_QUOTA_REACHED', code 1014
//   older WebKit        legacy constant name 'QUOTA_EXCEEDED_ERR'
const QUOTA_ERROR_NAMES = new Set([
  'QuotaExceededError',
  'NS_ERROR_DOM_QUOTA_REACHED',
  'QUOTA_EXCEEDED_ERR',
]);
const QUOTA_ERROR_CODES = new Set([22, 1014]);

/** True when `error` means "browser storage is full". */
export function isQuotaError(error) {
  if (!error) return false;
  const name = error.name || error.constructor?.name;
  if (name && QUOTA_ERROR_NAMES.has(name)) return true;
  if (QUOTA_ERROR_CODES.has(error.code)) return true;
  // Last resort: some environments (and our own test doubles) only carry a
  // message. Matching it is cheap and never worse than giving up.
  return /quota|storage is full|NS_ERROR_DOM_QUOTA_REACHED/i.test(String(error.message || ''));
}

/**
 * Size of a stored string in the unit browsers actually budget: UTF-16 code
 * units. Retention budgets are expressed in the same unit so a measurement
 * never needs a TextEncoder or a second pass over a half-megabyte payload.
 */
export function storageUnits(value) {
  return value == null ? 0 : String(value).length;
}

/** Resolve a storage object without throwing when the origin forbids one. */
export function getStorage(storage) {
  if (storage) return storage;
  try { return globalThis.localStorage || null; } catch (_) { return null; }
}

export function safeGetItem(key, storage) {
  const store = getStorage(storage);
  if (!store) return null;
  try { return store.getItem(key); } catch (_) { return null; }
}

export function safeRemoveItem(key, storage) {
  const store = getStorage(storage);
  if (!store) return false;
  try { store.removeItem(key); return true; } catch (_) { return false; }
}

/**
 * Run `operation`, and when it fails because storage is full, ask `reclaim`
 * to free space and try again. `reclaim(attempt)` returns truthy when it
 * actually released something; the first time it cannot, we stop.
 *
 * Returns { ok, value, error, reclaimed } and never throws for a quota
 * failure — callers decide how to tell the player.
 */
export function runWithQuotaRecovery(operation, { reclaim = null, maxAttempts = 32 } = {}) {
  let reclaimed = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      return { ok: true, value: operation(), error: null, reclaimed };
    } catch (error) {
      if (!reclaim || attempt >= maxAttempts || !isQuotaError(error)) {
        return { ok: false, value: null, error, reclaimed };
      }
      let freed = false;
      try { freed = !!reclaim(attempt); } catch (_) { freed = false; }
      if (!freed) return { ok: false, value: null, error, reclaimed };
      reclaimed++;
    }
  }
}

/** setItem with the same recovery contract as runWithQuotaRecovery. */
export function setItemWithRecovery(key, value, { storage, reclaim = null, maxAttempts } = {}) {
  const store = getStorage(storage);
  if (!store) {
    return { ok: false, value: null, error: new Error('Storage is unavailable'), reclaimed: 0 };
  }
  return runWithQuotaRecovery(() => { store.setItem(key, value); return true; }, { reclaim, maxAttempts });
}

/**
 * Hand the player a file containing `text`. This is the last line of defence
 * when nothing can be persisted: a Blob object URL needs no storage at all.
 * Returns true when the download was started.
 */
export function downloadTextFile(filename, text, { mime = 'application/json' } = {}) {
  const doc = globalThis.document;
  const URLCtor = globalThis.URL;
  const BlobCtor = globalThis.Blob;
  if (!doc?.body || !BlobCtor || !URLCtor?.createObjectURL) return false;
  try {
    const url = URLCtor.createObjectURL(new BlobCtor([text], { type: mime }));
    const anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    doc.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // unref where it exists (Node test drivers) so a pending revoke never
    // holds the process open; in browsers this is a no-op on a numeric id.
    const revoke = setTimeout(() => { try { URLCtor.revokeObjectURL(url); } catch (_) {} }, 5000);
    revoke?.unref?.();
    return true;
  } catch (_) { return false; }
}
