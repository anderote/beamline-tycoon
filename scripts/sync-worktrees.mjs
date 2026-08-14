#!/usr/bin/env node
// scripts/sync-worktrees.mjs — the integration loop for parallel worktree sessions.
//
// Several agent sessions develop in .claude/worktrees/*, each on its own branch.
// Master is what the user actually plays, so integration is one-way and gated:
//
//   status     what every worktree has, and whether it can move
//   integrate  merge worktree branches INTO master, running the suite after each
//   pull       fast-forward every caught-up worktree branch UP TO master
//
// A full cycle is `integrate` then `pull`: work lands on master, then every other
// session rebases its floor onto the integrated result without touching its own
// in-progress edits. Branches that are 0-ahead of master (all their work merged)
// fast-forward cleanly, which is the steady state this is built around.
//
// Guardrails, deliberate:
//   - integrate refuses to run with a dirty master tree. Merging reads the index,
//     and this checkout is shared by several sessions; a clean tree is what makes
//     that safe.
//   - a red suite after a merge STOPS the run and reports. It never resets or
//     reverts — untangling a bad merge is the human's call.
//   - pull skips any worktree that is dirty or has unmerged commits, rather than
//     fighting a session that is mid-edit.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function git(args, cwd = root) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: res.status === 0, out: (res.stdout || '').trim(), err: (res.stderr || '').trim() };
}

// Every linked worktree except the main checkout, which is master itself.
function worktrees() {
  const out = git(['worktree', 'list', '--porcelain']).out;
  const list = [];
  let cur = {};
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) cur = { dir: line.slice(9) };
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace('refs/heads/', '');
    else if (line === '') { if (cur.dir) list.push(cur); cur = {}; }
  }
  if (cur.dir) list.push(cur);
  return list.filter(w => w.dir !== root && w.branch && w.branch !== 'master');
}

function describe(w) {
  const counts = git(['rev-list', '--left-right', '--count', `master...${w.branch}`]).out.split(/\s+/);
  const behind = Number(counts[0] || 0);   // commits master has that the branch lacks
  const ahead = Number(counts[1] || 0);    // commits the branch has that master lacks
  const dirty = git(['status', '--porcelain'], w.dir).out !== '';
  return { ...w, ahead, behind, dirty };
}

function tests() {
  const res = spawnSync('node', [path.join('scripts', 'run-tests.mjs')], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { ok: res.status === 0, out: (res.stdout || '') + (res.stderr || '') };
}

function name(w) { return w.branch.replace(/^worktree-/, ''); }

// ---- status ---------------------------------------------------------------

function cmdStatus() {
  const rows = worktrees().map(describe);
  const w = Math.max(...rows.map(r => r.branch.length), 6);
  console.log(`${'branch'.padEnd(w)}  ahead  behind  state`);
  for (const r of rows) {
    const state = r.ahead > 0 ? (r.dirty ? 'has work + dirty' : 'has work to integrate')
      : r.dirty ? 'dirty — commit before pull'
        : r.behind > 0 ? 'ready to fast-forward'
          : 'up to date';
    console.log(`${r.branch.padEnd(w)}  ${String(r.ahead).padStart(5)}  ${String(r.behind).padStart(6)}  ${state}`);
  }
  const pending = rows.filter(r => r.ahead > 0);
  console.log(pending.length
    ? `\n${pending.length} branch(es) with unintegrated work: ${pending.map(name).join(', ')}`
    : '\nNothing to integrate — every branch is merged.');
}

// ---- integrate ------------------------------------------------------------

function cmdIntegrate(argv) {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).out;
  if (branch !== 'master') {
    console.error(`integrate must run from the master checkout (this is ${branch}).`);
    process.exit(1);
  }
  if (git(['status', '--porcelain']).out !== '') {
    console.error('master has uncommitted changes. Commit or set them aside first —\n' +
      'merging into a dirty shared checkout is how sessions clobber each other.');
    process.exit(1);
  }

  const rows = worktrees().map(describe).filter(r => r.ahead > 0);
  const want = argv.length ? rows.filter(r => argv.includes(r.branch) || argv.includes(name(r))) : rows;
  if (!want.length) { console.log('Nothing to integrate.'); return; }

  const done = [];
  for (const r of want) {
    console.log(`\n=== merging ${r.branch} (${r.ahead} commit${r.ahead === 1 ? '' : 's'}) ===`);
    const m = git(['merge', '--no-ff', '--no-edit', r.branch]);
    if (!m.ok) {
      console.error(m.err || m.out);
      console.error(`\nMerge of ${r.branch} did not complete. Master is mid-merge — resolve or\n` +
        '`git merge --abort` by hand. Stopping here; nothing after this was touched.');
      process.exit(1);
    }
    const t = tests();
    if (!t.ok) {
      process.stdout.write(t.out);
      console.error(`\nSuite is RED after merging ${r.branch}. The merge commit is still in place —\n` +
        'fix forward or unwind it yourself. Stopping; remaining branches untouched.');
      process.exit(1);
    }
    console.log(`green after ${r.branch}`);
    done.push(r);
  }
  console.log(`\nIntegrated: ${done.map(name).join(', ')}. Master is green.`);
  console.log('Run `node scripts/sync-worktrees.mjs pull` to bring the other sessions up.');
}

// ---- pull -----------------------------------------------------------------

function cmdPull() {
  const rows = worktrees().map(describe);
  const moved = [], skipped = [];
  for (const r of rows) {
    if (r.behind === 0) continue;
    if (r.ahead > 0) { skipped.push(`${name(r)} (${r.ahead} unintegrated commit(s))`); continue; }
    if (r.dirty) { skipped.push(`${name(r)} (uncommitted changes)`); continue; }
    const ff = git(['merge', '--ff-only', 'master'], r.dir);
    if (ff.ok) moved.push(`${name(r)} (+${r.behind})`);
    else skipped.push(`${name(r)} (${(ff.err || ff.out).split('\n')[0]})`);
  }
  console.log(moved.length ? `Fast-forwarded: ${moved.join(', ')}` : 'No worktree needed a fast-forward.');
  if (skipped.length) console.log(`Skipped: ${skipped.join(', ')}`);
}

const [cmd = 'status', ...rest] = process.argv.slice(2);
if (cmd === 'status') cmdStatus();
else if (cmd === 'integrate') cmdIntegrate(rest);
else if (cmd === 'pull') cmdPull();
else { console.error('usage: sync-worktrees.mjs [status|integrate [branch...]|pull]'); process.exit(1); }
