# Beamline Tycoon

## Rules

- Never overwrite asset files (images, PNGs, etc.) without explicit user approval. Always confirm before replacing any file in `assets/`.
- Implementation plans should specify *what* to do, not transcribe every line of code. Capture the design (file paths, function signatures, data shapes, ordering, acceptance criteria), not the keystrokes. Inline code in plans only when (a) the code encodes a non-obvious decision worth pinning, (b) it's a tiny snippet that's faster to read than describe, or (c) it's a template that other steps reference. For boilerplate, mechanical edits, or "paste this verbatim" content, write a one-line directive ("add 5 paint variants via gen_solidNoise with palettes X/Y/Z") and let the implementer write the code. A 1000-line plan that's 90% transcribed code is wasted upfront work and wasted reviewer attention.
- Commits group at logical boundaries, not task boundaries. If a plan splits work into 6 small tasks (e.g. "add RF decals", "add cooling decals", "add safety decals") that all touch the same file in the same way, that's one commit, not six. Aim for commits that are independently reviewable, revertable, and tell a coherent story — not micro-commits per checklist item. Same applies to inline-execution flows: don't `git commit` between every task if the next task is the obvious continuation of the same change.
