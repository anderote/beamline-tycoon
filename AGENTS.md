# Beamline Tycoon Development Workflow

These repository instructions are the default operating procedure for Codex and
other development agents working on Beamline Tycoon.

## Canonical branches

- `master` is the stable, locally playable branch. The game on port 8000 runs
  from the root worktree on `master`.
- `dev` is the integration branch. Completed feature work is reconciled and
  tested here before it reaches `master`.
- `master` must never contain commits that are absent from `dev`. Do not commit,
  cherry-pick, or develop features directly on `master`.

## Starting feature work

For every new feature or fix, unless the user explicitly requests otherwise:

1. Start from the current `dev` head, never from `master` or an older feature
   branch.
2. Create a dedicated branch named `agent/<short-feature-slug>`.
3. Create a dedicated linked worktree for that branch outside the root checkout.
4. Keep the root worktree on `master` so the locally running game stays stable.
5. Make, validate, and commit only that feature's scoped changes in its worktree.

Typical setup:

```sh
git worktree add -b agent/<short-feature-slug> ../beamline-tycoon-<short-feature-slug> dev
```

## Local development servers

- Port `8000` is reserved exclusively for the stable game served from the root
  `master` worktree. Feature, fix, test, and review worktrees must never start,
  stop, replace, or kill the listener on port `8000`.
- Do not run `npm run dev` from a non-root worktree. Its `predev` script kills
  the process on port `8000`, even when a different Vite port is passed later.
- Discover a currently unused ephemeral port for every local server launch;
  do not reuse a hard-coded alternate port. Start Vite directly with
  `--strictPort` so a race for that port fails visibly instead of silently
  moving the server again.
- Keep track of the exact process or tool session that owns the temporary
  server. When testing is finished (including after an error or interruption),
  terminate that exact process and verify its port is no longer listening.
  Never use a broad `pkill`, `killall`, or unrelated-port cleanup command.

Typical isolated server lifecycle:

```sh
beamline_port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')
npm exec vite -- --host 127.0.0.1 --port "$beamline_port" --strictPort

# After testing, stop that exact Vite process/session, then confirm cleanup:
lsof -tiTCP:"$beamline_port" -sTCP:LISTEN
```

The final `lsof` command must print nothing. If it prints a PID, the temporary
server still needs to be stopped before the task is handed off.

## Completing feature work

1. Commit all intended feature changes in the feature worktree.
2. Merge the completed feature branch into `dev` from the dedicated `dev`
   worktree, resolving integration conflicts there.
3. Run validation appropriate to the combined `dev` result.
4. Push `dev` after successful integration when a remote is available.
5. Immediately remove the completed feature worktree and delete its merged local
   feature branch. Do not leave finished worktrees around.

Typical cleanup:

```sh
git worktree remove ../beamline-tycoon-<short-feature-slug>
git branch -d agent/<short-feature-slug>
```

Never remove a worktree containing uncommitted work unless the user explicitly
authorizes discarding it.

## Promoting dev to master

Promotion is periodic and deliberate:

1. Confirm `dev` is clean, integrated, and validated.
2. Fast-forward `master` from `dev`; do not independently merge feature branches
   into `master`.
3. Push `master` only after that promotion.
4. Keep `dev` at least equal to `master` at all times. If `master` ever advances
   unexpectedly, reconcile it into `dev` immediately before starting more work.

Typical promotion:

```sh
git -C /path/to/master-worktree merge --ff-only dev
git -C /path/to/master-worktree push origin master
```

## Multi-agent coordination

- Each agent owns one feature worktree and branch at a time.
- Do not edit another agent's dirty worktree or rewrite its branch.
- Reconcile concurrent features on `dev`, not on `master`.
- Before creating or removing a worktree, inspect `git worktree list` and preserve
  unrelated user or agent changes.
