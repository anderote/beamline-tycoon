// src/game/CloudSaves.js — thin client for the Deep Tech Week cloud-save API.
//
// The game is deployed on deep-tech-week.com inside an iframe at
// /beamline-tycoon-game/; the API lives at the site root, so all paths here
// are absolute. In local dev there is no API — detect() reports
// { available: false } and the game stays in local (localStorage) mode.
//
// Endpoints (same-origin, cookie-authenticated):
//   GET    /api/beamline-tycoon/me           -> { id, name } | 401
//   GET    /api/beamline-tycoon/saves        -> { saves: [{slot,name,meta,updatedAt}] } | 401
//   GET    /api/beamline-tycoon/saves/:slot  -> { slot,name,payload,meta,updatedAt } | 404 | 401
//   PUT    /api/beamline-tycoon/saves/:slot  -> { ok:true } | 400 | 401   (body {name,payload,meta})
//   DELETE /api/beamline-tycoon/saves/:slot  -> { ok:true } | 401
//
// Slots are 1..3. payload is the game's serialized JSON string (<=2MB).

const BASE = '/api/beamline-tycoon';

// Thrown on 401 — the DTW session expired (or was never established).
// UI catches this by name/instance and shows the sign-in prompt.
export class CloudAuthError extends Error {
  constructor() {
    super('Not signed in');
    this.name = 'CloudAuthError';
    this.status = 401;
  }
}

// Any other non-OK response (400 size cap, 404, 5xx...).
export class CloudApiError extends Error {
  constructor(status, message) {
    super(message || `Cloud save request failed (${status})`);
    this.name = 'CloudApiError';
    this.status = status;
  }
}

async function request(path, opts = {}) {
  const res = await fetch(BASE + path, { credentials: 'same-origin', ...opts });
  if (res.status === 401) throw new CloudAuthError();
  if (!res.ok) {
    let msg = null;
    try { msg = (await res.json())?.error; } catch (_) { /* non-JSON body */ }
    throw new CloudApiError(res.status, msg);
  }
  return res.json();
}

export const CloudSaves = {
  // Probe for the API. Never throws.
  //   { available: false }                          — no API (local dev) / network error
  //   { available: true, signedIn: false }          — API present, session expired (401)
  //   { available: true, signedIn: true, user }     — signed in; user = { id, name }
  async detect() {
    try {
      const res = await fetch(BASE + '/me', { credentials: 'same-origin' });
      if (res.status === 401) return { available: true, signedIn: false };
      if (!res.ok) return { available: false };
      const user = await res.json();
      return { available: true, signedIn: true, user };
    } catch (_) {
      return { available: false };
    }
  },

  // -> [{ slot, name, meta, updatedAt }] (slots 1..3; absent slot = empty)
  async list() {
    const data = await request('/saves');
    return Array.isArray(data?.saves) ? data.saves : [];
  },

  // -> { slot, name, payload, meta, updatedAt } (404 -> CloudApiError)
  load(slot) {
    return request(`/saves/${slot}`);
  },

  save(slot, name, payload, meta = {}) {
    return request(`/saves/${slot}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, payload, meta }),
    });
  },

  remove(slot) {
    return request(`/saves/${slot}`, { method: 'DELETE' });
  },
};
