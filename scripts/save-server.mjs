#!/usr/bin/env node
// scripts/save-server.mjs — one save store, shared by every worktree.
//
// Saves normally live in localStorage, which is scoped to an origin: master on
// :8000 and a worktree on :8010 are different origins, so they cannot see each
// other's games. This server gives them one store they all reach.
//
// It speaks the same API the production deployment does — the five endpoints
// src/game/CloudSaves.js already calls — so nothing in the game changes. Each
// worktree's vite.config.js already proxies /api to localhost:8001, which is
// where this listens, so `node scripts/save-server.mjs` is the whole setup.
//
// Because CloudSaves.detect() now succeeds in dev, SaveLoadDialog renders in
// cloud mode: three numbered slots and a "signed in as" header instead of the
// unlimited named localStorage slots. That is the trade deliberately made here.
//
// Scope, deliberate:
//   - The ACTIVE/autosave key (`beamlineTycoon`) stays in localStorage in both
//     modes — see SaveLoadDialog. So the autosave still diverges per port; what
//     is shared is the three explicit slots. Save a slot in one worktree, load
//     it in another.
//   - No auth. /me returns a stub user. This binds to loopback and is a dev
//     tool; do not put it on a network.
//   - Writes are atomic (tmp + rename) so a crash mid-save cannot leave a slot
//     truncated. Saves are the one thing here worth not losing.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const PORT = Number(process.env.PORT || 8001);
const HOST = '127.0.0.1';
const DIR = process.env.BT_SAVE_DIR || path.join(os.homedir(), '.beamline-tycoon', 'saves');
const MAX_BYTES = 2 * 1024 * 1024; // matches the production 2MB payload cap
const SLOTS = ['1', '2', '3'];
const USER = { id: 'local', name: 'local dev' };

const slotFile = (slot) => path.join(DIR, `slot-${slot}.json`);

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': 'no-store',
  });
  res.end(json);
}

async function readSlot(slot) {
  try {
    return JSON.parse(await fs.readFile(slotFile(slot), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// tmp + rename: a half-written save is worse than no save.
async function writeSlot(slot, record) {
  await fs.mkdir(DIR, { recursive: true });
  const tmp = slotFile(slot) + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(record));
  await fs.rename(tmp, slotFile(slot));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      // Hang up rather than buffer an unbounded body.
      if (size > MAX_BYTES) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${HOST}`);
  const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');

  // /api/beamline-tycoon/...
  if (parts[0] !== 'api' || parts[1] !== 'beamline-tycoon') return send(res, 404, { error: 'Not found' });
  const [, , resource, slot] = parts;

  if (resource === 'me' && req.method === 'GET') return send(res, 200, USER);

  if (resource === 'saves' && slot === undefined && req.method === 'GET') {
    const saves = [];
    for (const s of SLOTS) {
      const rec = await readSlot(s);
      // An absent slot is simply omitted — the client treats missing as empty.
      if (rec) saves.push({ slot: Number(s), name: rec.name, meta: rec.meta, updatedAt: rec.updatedAt });
    }
    return send(res, 200, { saves });
  }

  if (resource === 'saves' && SLOTS.includes(slot)) {
    if (req.method === 'GET') {
      const rec = await readSlot(slot);
      if (!rec) return send(res, 404, { error: 'Empty slot' });
      return send(res, 200, { slot: Number(slot), ...rec });
    }

    if (req.method === 'PUT') {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch (err) {
        const tooBig = /too large/.test(err.message);
        return send(res, 400, { error: tooBig ? `Save exceeds the ${MAX_BYTES / 1024 / 1024}MB limit.` : 'Malformed body' });
      }
      if (typeof body?.payload !== 'string') return send(res, 400, { error: 'payload must be a string' });
      await writeSlot(slot, {
        name: String(body.name || `Slot ${slot}`).slice(0, 60),
        payload: body.payload,
        meta: body.meta && typeof body.meta === 'object' ? body.meta : {},
        updatedAt: Date.now(),
      });
      return send(res, 200, { ok: true });
    }

    if (req.method === 'DELETE') {
      await fs.rm(slotFile(slot), { force: true });
      return send(res, 200, { ok: true });
    }
  }

  return send(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(`${req.method} ${req.url} ->`, err);
    send(res, 500, { error: 'Internal error' });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`beamline-tycoon save server on http://${HOST}:${PORT}`);
  console.log(`saves in ${DIR}`);
  console.log('every worktree proxies /api here, so all of them share these slots.');
});
