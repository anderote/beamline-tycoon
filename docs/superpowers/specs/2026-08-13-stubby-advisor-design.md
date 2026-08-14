# Stubby — the facility advisor

## Problem

The game already computes a great deal of advice and then says almost none of
it. Utility faults land in `state.infraBlockers` with a real taxonomy; the
physics engine reports `dispersionWarnings`; the focus advisor produces
`ghostQuads`; `src/data/tutorial.js` carries a hint per step. Each of these is
surfaced, if at all, in one view, in one format, at one moment — and the focus
advisor spent its whole life drawing a single arrow off the right-hand edge of
a canvas nobody had scrolled.

There is no channel that says "here is the most important thing wrong with your
facility right now, and here is where it is". `_showToast` is transient input
feedback ("Move mode off") with no persistence and no actions; it is the wrong
vehicle and stays as it is.

## Approach

An advice bus with a character in front of it: **Stubby**, a three-stub tuner
who watches the facility and speaks up when something is worth knowing.

Rules are pure predicates over a context snapshot — the shape `tutorial.js`
already uses for `condition(state)`. Keeping every rule in one declarative
table means the whole of what Stubby knows can be read on one screen and
tested without a DOM.

Rejected: emitting advice events from each subsystem (scatters the logic across
a dozen files and makes ranking impossible, since no one holds the full
picture); extending `tutorial.js` (its steps are one-shot goals with completion
tracking, whereas advice recurs and needs cooldowns — the semantics would
corrupt the checklist).

## Modules

| File | Responsibility |
| --- | --- |
| `src/advisor/context.js` | `buildAdvisorContext(game, designer)` → one plain snapshot |
| `src/advisor/rules.js` | `ADVICE_RULES`, the declarative table |
| `src/advisor/engine.js` | `AdvisorEngine` — evaluate, rank, suppress |
| `src/ui/stubby-sprite.js` | `drawStubby(canvas, {frame})` — procedural pixel art |
| `src/ui/Stubby.js` | the presenter: corner sprite, bubble, actions |

### Context

`buildAdvisorContext(game, designer)` gathers everything the rules read, once,
into a plain object with no live references into game state. Rules must not
reach back into `game` — a rule that reads live state cannot be tested against
a fixture and cannot be reasoned about in isolation.

`state.unwiredSinks` is deliberately absent. It is a nested object,
`{ [placeableId]: { [utility]: true } }`, and the utility gate has already
turned every hard-required unwired sink into an `infraBlockers` entry carrying
the placeable, the port and a code. Nothing needs the raw topology. An early
draft copied it as if it were an array; the `.map` threw on every tick, and
because `Game.emit` iterates listeners with a bare `forEach`, that took out
the rest of the tick with it. Fixtures must use the shapes the game really
publishes — a fixture invented to match an assumption will agree with the bug.

```js
{
  tick, funding, income, expenses,
  blockers: [{code, message, severity, placeableId, portName, zoneId}],
  beamRunning, hasOperator,
  placeableCount, beamlineCount,
  ghostQuads: [{s, nodeIndex, polarity}],            // designer, may be empty
  dispersionWarnings: [{elementIndex, elementType, etaX, s}],
  tutorial: {nextStep: {id, name, hint, group} | null},
}
```

### Rule shape

```js
{
  id: 'utilities.power-unconnected',
  group: 'utilities',                  // optics | utilities | staffing | economy | tutorial
  severity: 'blocker',                 // blocker | warning | tip
  cooldownTicks: 60,
  when(ctx) -> false | payload,        // pure
  say(ctx, payload) -> {title, body},
  action?: {label, run(game, payload)},
}
```

`when` returns a falsy value for "nothing to say", or a payload object carried
verbatim into `say` and `action.run`. The payload is what lets one rule speak
about a specific placeable rather than a category.

### Emitted advice

```js
{ ruleId, key, severity, group, title, body, action }
```

`key` is the rule id plus a target discriminator — `utilities.power-unconnected:p42`.
Cooldowns and dismissals are keyed on `key`, not `ruleId`, so silencing one
unwired magnet does not silence the next one. A rule whose payload has no
target degrades to `ruleId` alone.

### Engine

`AdvisorEngine`:

- `evaluate(ctx)` — run every rule's `when`, build the advice list.
- Ranking: severity (`blocker` > `warning` > `tip`), then declaration order in
  the table. Declaration order is therefore meaningful and the table is
  ordered deliberately.
- Suppression: drop any advice whose `key` is dismissed, or whose `key` is
  within `cooldownTicks` of when it was last shown.
- `current()` — the single highest-ranked surviving advice, or null. Stubby
  says one thing at a time; a character who lists six problems is a log.
- `dismiss(key)` — hide this instance until it recurs after its cooldown.
- `silence(key)` — hide permanently; persisted in the save.

Cadence: the game tick, throttled to roughly one evaluation per two seconds of
game time, plus once per designer recalc so optics advice tracks edits. Never
per frame.

### Stubby the presenter

A fixed corner element, sprite plus speech bubble. On new advice that outranks
what is showing, the sprite plays a one-shot perk-up and the bubble opens.

The bubble carries title, body, an optional **Show me** action, **Got it**
(dismiss), and **Stop telling me this** (silence). It is never modal, never
takes keyboard focus, and confines `pointer-events` to itself — the failure
mode to avoid is a helper that eats clicks meant for the facility.

**Show me** is what makes Stubby worth more than a log: for a wiring fault it
pans the camera to the offending placeable; for a focus suggestion it opens the
designer and jumps to the ghost via `_jumpToNextGhost`.

### Art

Procedural pixel art in the idiom of `UIHost.drawSchematic` — a tiny canvas
drawn with `px(x,y,w,h,color)` and `dot(x,y,color)` helpers over a fixed
palette, scaled up with `image-rendering: pixelated`. No image assets, no
generated sprites.

A three-stub tuner is a rectangular waveguide run with three adjustable stubs
standing off it. Drawn as a pixely 3-D object: lit top face, mid front face,
dark right face, with the three stubs as capped cylinders along the top. The
stubs are the character — they rise, tilt and shiver to carry expression. A
face sits on the front face of the waveguide body.

Frames: `idle`, `alert`, `talk`, `pleased`. Each is a pure function of the
frame name, so frames are testable by drawing to an offscreen canvas and
asserting pixels differ.

## Rule set

Twelve rules, ordered by rank within severity.

**Blockers**
1. `utilities.unstaffed` — beamline built, no active operator.
2. `utilities.power-unconnected` — a placeable's `pwr_in` is unwired.
3. `utilities.vacuum-unconnected`
4. `utilities.cooling-unconnected`
5. `utilities.rf-unconnected`
6. `utilities.cryo-unconnected`

**Warnings**

7. `optics.needs-focusing` — the focus advisor has suggestions outstanding.
8. `optics.dispersion` — uncorrected dispersion at the end of the line.
9. `economy.burning-cash` — expenses exceed income and funding is falling.

**Tips**

10. `economy.idle-funding` — a large balance sitting unspent.
11. `tutorial.next-step` — the next incomplete tutorial step's hint.
12. `optics.no-quads` — a beamline of meaningful length with no focusing at all.

Rules 2–6 share one implementation parameterised over `UNCONNECTED_CODES`, so
the table has six entries generated from one factory rather than six copies.

## Testing

Rules and engine are pure and get Node tests:

- each rule's `when` against fixture contexts that should and should not fire;
- ranking across mixed severities;
- cooldown expiry and `key`-scoped suppression — dismissing one target leaves a
  sibling target still speaking;
- `silence` surviving a save round trip;
- sprite frames producing visibly different pixels.

The presenter wants a browser spec. The Playwright harness on this branch drops
its vite server partway through every run, so the presenter is verified by eye
and that limitation is recorded rather than papered over.

## Out of scope

Dialogue trees, chat, any model call, voice lines, a personality state machine,
more than one piece of advice at a time.
