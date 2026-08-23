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
- Do not run `npm run dev` for isolated validation because it does not reserve
  an ephemeral port or enable `--strictPort`. The package deliberately has no
  script that kills an existing listener.
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

## Architecture and content contracts

- Read `docs/ARCHITECTURE.md` before changing ownership boundaries or adding a
  new subsystem. Read `docs/CONTENT-CONTRACTS.md` before adding or changing
  placeables, utility ports, research unlocks, scenarios, or stock designs.
- Preserve the dependency direction described there. In particular, data
  modules must not acquire indirect runtime dependencies, and all `src/`
  imports must remain acyclic (`test/test-import-boundaries.js` enforces this).
- Prefer a small command or coordinator module when adding transactional
  behavior to `Game.js`, `InputHandler.js`, or `ThreeRenderer.js`. Keep those
  files as composition/event-routing surfaces; do not add another multi-step
  workflow directly when it can be tested through a public function or class.
- Cross-module calls use public methods. Underscored methods are private to
  their owner and must not become a new test or integration seam.
- Scenario wiring selects utility ports by capability (`utility`, `role`,
  optional `side`/`index`) through `src/utility/port-contracts.js`. Do not copy
  authored connector names into scenario scripts unless the exact physical
  connector is itself part of the scenario's intent.
- Production UI displays published game/solver values; it must not independently
  recompute economy, utility, or beam-physics quantities.

## Validation

- Follow `docs/TESTING.md`. During development, run the closest focused test,
  then `npm run test:fast` and `npm run build` before handoff.
- Run `npm run test:simulation` whenever economy, staffing, scenario, or
  utility-topology changes can affect a facility's operating balance.
- `npm test` / `npm run test:all` is the complete non-browser gate. Codex and
  other development agents must never launch or control a browser, open browser
  windows, run Playwright or `npm run test:browser`, use Browser, Chrome, or
  computer-use tools to operate a browser, or perform manual game playtesting
  while working in this repository. The repository owner performs all browser
  and gameplay validation. Agents must restrict validation to non-browser tests
  and builds, then hand off any remaining playtesting checklist to the owner.
- A changed contract requires a test at the contract boundary, not only a test
  of the current implementation's private helpers.

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

Promotion is controlled by the repository owner. By default, agents may validate
`dev` and report that it is ready for promotion, but must stop before changing
`master`.

An agent may fast-forward and push `master` only when the repository owner
explicitly requests that promotion in the current conversation (for example,
"promote dev to master" or "push dev to master"). An explicit promotion request
authorizes only the integrated, fast-forward-only `dev` -> `master` workflow
below. It does not authorize force-pushing, merging a feature branch directly
into `master`, or committing new work on `master`.

Promotion itself is not another validation gate. Feature integrations should
already have received their scoped validation on `dev`; do not rerun `npm test`,
`npm run test:fast`, or `npm run build` solely because an owner requested a
promotion. Fast-forward and push first, then observe the existing stable server
on port `8000` while it rebuilds. Never start, stop, replace, or browser-control
that listener. If it exists, preserve its exact process, check that it remains
listening and HTTP-responsive, and inspect its already-accessible output for
rebuild errors. If it is absent or its output is not accessible, report that
instead of launching a replacement.

For owner-authorized promotion, whether performed manually or by an agent:

1. Confirm `dev` is clean and integrated.
2. Capture the complete pre-promotion `master..dev` commit range for the
   promotion report. Summarize all work in that range, not only the feature or
   request that triggered the promotion.
3. Fast-forward `master` from `dev`; do not independently merge feature branches
   into `master`.
4. Push `master` only after that promotion.
5. Keep `dev` at least equal to `master` at all times. If `master` ever advances
   unexpectedly, reconcile it into `dev` immediately before starting more work.
6. Observe the existing port `8000` listener as described above and record its
   post-promotion rebuild/health result.
7. Report the promotion to the repository owner with a concise grouped summary
   of the entire promoted range: player-facing features, fixes/performance work,
   and workflow/documentation changes as applicable. Include earlier validation
   reported for the integrated work, the port `8000` observation, the promoted
   commit, push status, and any browser/gameplay checks that remain for the
   owner. This report is required after every promotion.

Promotion reference:

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
