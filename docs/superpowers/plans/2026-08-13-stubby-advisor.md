# Stubby — implementation plan

Spec: `docs/superpowers/specs/2026-08-13-stubby-advisor-design.md`

Six tasks. Tasks 1–3 are the bus and are independently testable without a DOM;
4–5 are the character; 6 wires it in. One commit at the end — the tasks all
touch the same new subsystem and split into no independently revertable story.

## 1. Context — `src/advisor/context.js`

`buildAdvisorContext(game, designer)` returns the snapshot in the spec. Reads
`state.infraBlockers`, `state.resources`, `state.tick`, `state.beamPipes`,
`state.placeables`, plus `designer?.ghostQuads` and the draft result's
`dispersionWarnings` when a designer is open. NOT `state.unwiredSinks` — see
the spec; the blockers already carry what the rules need, and its actual shape
is a nested object rather than an array.

Deep-copies or maps to fresh objects — no live references into game state, so a
rule cannot mutate the game and a fixture context is a faithful stand-in.

Tolerate a partially-booted game: every field defaults (empty arrays, zeros,
nulls) rather than throwing, since the advisor runs on the tick and the tick
starts before physics is ready.

Acceptance: given a fixture game object with missing sub-objects, returns a
fully-populated context with no throw.

## 2. Rules — `src/advisor/rules.js`

Export `ADVICE_RULES`, ordered as the spec lists them. Rules 2–6 come from a
factory over `UNCONNECTED_CODES` (imported from `src/game/utility-gate.js`, the
existing source of truth — do not restate the codes).

Each rule's `when` is pure over the context and returns a payload carrying the
target id where one exists, so `key` can discriminate.

Copy voice: short, first-person, technical but plain. Stubby is a competent
colleague, not a mascot doing bits — one sentence saying what is wrong, one
saying what to do.

Acceptance: every rule fires on a context built to trigger it and stays silent
on one built not to.

## 3. Engine — `src/advisor/engine.js`

`AdvisorEngine` class per the spec: `evaluate(ctx)`, `current()`,
`dismiss(key)`, `silence(key)`, plus `toJSON`/`fromJSON` for the silenced set.

Severity rank is a module constant, not scattered comparisons.

Cooldown state is a `Map<key, tickLastShown>`; `evaluate` needs `ctx.tick` to
resolve expiry. A key never shown has no entry and is not suppressed.

Acceptance: ranking, cooldown expiry, key-scoped dismissal (one target silenced
leaves a sibling speaking), silence surviving a JSON round trip.

## 4. Sprite — `src/ui/stubby-sprite.js`

`drawStubby(canvas, {frame})` and `STUBBY_FRAMES`. Native 40×40, drawn with
local `px`/`dot` helpers over a palette local to the module (the schematic
palette in `overlays.js` is private to `drawSchematic` and should not be
exported for this — duplicating six colours is cheaper than widening that
interface).

A waveguide body in pixely 3-D: lit top face, mid front, dark right, with three
capped stubs along the top. Face on the front. Frames `idle`, `alert`, `talk`,
`pleased` vary stub heights and eye/mouth pixels.

Acceptance: each frame produces a different pixel buffer from `idle`; nothing
drawn outside the 40×40 bounds.

## 5. Presenter — `src/ui/Stubby.js`

Class owning a root element built in JS (not `index.html` — the advisor is one
self-contained unit and its markup belongs with it). Renders sprite canvas plus
bubble. `update(advice)` diffs against what is showing and only re-renders and
re-animates when the `key` changes, so a rule that fires every evaluation does
not restart its animation twice a second.

Buttons wire to `dismiss` / `silence` / `action.run`. Bubble is
`pointer-events: auto` on itself, the container `pointer-events: none`, so
Stubby never eats a click meant for the facility.

CSS in `style.css` beside the other `dsgn-`/HUD blocks, following the existing
pixel-UI conventions.

## 6. Wiring

- Instantiate in the same place the HUD is built; hold on `game` or the UI host,
  following whatever that file already does for long-lived UI.
- Evaluate on the game tick, throttled to ~2 s of game time.
- Evaluate on designer recalc so optics advice tracks edits.
- Persist the silenced set in the save alongside other UI prefs.

Acceptance: full node suite green; Stubby appears with real advice on a facility
with an unwired sink.

## Verification

`npm test` after each of 1–3 and at the end. Browser suite attempted and its
outcome reported honestly — it currently drops its vite server mid-run, so a
clean pass may not be obtainable; do not claim the presenter is verified if it
is not.
