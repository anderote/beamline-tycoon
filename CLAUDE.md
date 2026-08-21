# Beamline Tycoon

## Workflow: follow AGENTS.md

**`AGENTS.md` in this repo is the canonical development workflow, and it applies
to Claude Code exactly as it does to Codex.** Read it before starting work.
Everything below is additional, not a replacement.

The parts most easily got wrong, restated because they are non-negotiable:

- **Never commit directly on `master`, and never develop on it.** `master` must
  never contain a commit that is absent from `dev`. The root checkout stays on
  `master` so the game the owner plays on port 8000 stays stable.
- **Every feature or fix starts from `dev` in its own branch and its own linked
  worktree**, created outside the root checkout:
  `git worktree add -b agent/<slug> ../beamline-tycoon-<slug> dev`
  Do the work there — including all subagent work; pass the worktree path to
  every subagent you dispatch.
- **Merge the finished branch into `dev` from the `dev` worktree**, then remove
  the feature worktree and delete the merged branch. Don't leave finished
  worktrees lying around.
- **Promotion to `master` is the owner's call**, requested explicitly in the
  current conversation, and is fast-forward-only from `dev`. One request
  authorizes one promotion.
- **Port 8000 belongs to the owner's running game.** Never start, stop, or kill
  it. Use an ephemeral port with `--strictPort` for isolated servers and clean
  up the exact process afterwards.

This overrides the global CLAUDE.md guidance about working directly in the main
working directory and not creating branches or worktrees. That guidance is for
other projects; here, worktree isolation exists to protect a live play session,
not for git hygiene.

## Browser validation — a deliberate exception to AGENTS.md

`AGENTS.md` forbids development agents from launching a browser or running
Playwright, reserving all browser validation for the owner. **Claude Code is
exempted from that clause**, at the owner's explicit direction (2026-08-21).

The reason is concrete: the app renders through `WebGPURenderer`
(`src/renderer3d/renderer-backend.js`), and a batching bug shipped to the owner's
screen after passing all 262 non-browser suites plus a triangle-level geometry
probe, because the defect only exists on the WebGPU backend. Non-browser tests
cannot see that class of bug.

Two things follow:

- Drive a real browser via Playwright rather than asking the owner to paste
  snippets into a dev console. Anything a console snippet can do,
  `page.evaluate()` can do.
- **`test/browser/helpers.mjs`'s `SWIFTSHADER_ARGS` forces WebGL2**, so most
  browser specs validate a backend the game does not ship. When testing renderer
  behaviour, use the real-WebGPU launch flags from
  `test/browser/wall-up-mode.spec.mjs`.

Playwright starts its own server on a free port and never touches port 8000.

## Rules

- Never overwrite asset files (images, PNGs, etc.) without explicit user approval. Always confirm before replacing any file in `assets/`.
- Implementation plans should specify *what* to do, not transcribe every line of code. Capture the design (file paths, function signatures, data shapes, ordering, acceptance criteria), not the keystrokes. Inline code in plans only when (a) the code encodes a non-obvious decision worth pinning, (b) it's a tiny snippet that's faster to read than describe, or (c) it's a template that other steps reference. For boilerplate, mechanical edits, or "paste this verbatim" content, write a one-line directive ("add 5 paint variants via gen_solidNoise with palettes X/Y/Z") and let the implementer write the code. A 1000-line plan that's 90% transcribed code is wasted upfront work and wasted reviewer attention.
- Commits group at logical boundaries, not task boundaries. If a plan splits work into 6 small tasks (e.g. "add RF decals", "add cooling decals", "add safety decals") that all touch the same file in the same way, that's one commit, not six. Aim for commits that are independently reviewable, revertable, and tell a coherent story — not micro-commits per checklist item. Same applies to inline-execution flows: don't `git commit` between every task if the next task is the obvious continuation of the same change.
- This project is pre-release and single-user. **Ignore backwards save-file compatibility.** When the data model changes, old saves don't need to load — don't waste effort on migrators, version bumps, or graceful-degradation shims. If a save format change would break existing saves, just break them.
- For small game-design and game-mechanics decisions where there's no explicit user preference, **defer to established game development best practices and conventions** rather than asking. Reserve questions for choices with meaningful trade-offs or that touch the core mental model of the game.
