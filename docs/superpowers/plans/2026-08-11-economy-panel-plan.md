# Economy Panel — implementation plan

Spec: `docs/superpowers/specs/2026-08-11-economy-panel-design.md`. Branch `followups`.
Gates per step: `npm test`, `npx vite build`.

## Step 1 — publish what the tick charges (`src/game/`)

`Game.tick()` currently applies income and upkeep and drops the breakdown. Record it.

- Accumulate the beam and data-fee terms during the existing per-beamline loop rather
  than re-deriving after it — re-deriving is the bug class this feature exists to avoid.
- Reservoir refills are event costs, not per-tick: accumulate them as they are charged
  and let the panel average over the window.
- Write `state.economySnapshot` once per tick with `{tick, income{grant, reputation,
  beam, dataFees, total}, upkeep{staff, power, pumps, refills, total}, net}`, and push
  `net` onto a fixed-capacity (~300) ring buffer at `state.economyHistory`.
- Both derived: confirm they are absent from `SERIALIZED_FIELDS` and from undo
  snapshots, and cleared/rebuilt on load.
- Expose a small read helper (e.g. `getEconomySnapshot()`) so the UI never reaches into
  raw state shape.

**Acceptance:** over one tick, the recorded snapshot's `net` equals the actual change in
`state.resources.funding` from tick income/upkeep. Terms sum to totals. Buffer capped.

## Step 2 — the window (`src/ui/EconomyWindow.js`)

A `ContextWindow` subclass modelled on `BeamlineWindow`/`EquipmentWindow`. Read those
first and follow them — id-registry dedupe, drag, esc-stack, `destroy` teardown.

- Layout per the spec: net + sparkline, income terms (with contributing beamline count),
  expense terms, runway, recent capital.
- Sparkline over `economyHistory`; plain canvas or inline SVG, sized to the window.
- Runway: "sustainable" when net ≥ 0, else ticks-to-zero at the current net.
- Recent capital from the Phase 10 resource ledger — do not add a parallel tracker.
- Formatting through `src/ui/format.js` (`fmtMoney`) — do not hand-roll.
- Subscribe to `tick` for refresh; **capture the unsubscribe and call it on close.**

## Step 3 — wire it up

- `Economy` button in `#top-buttons` in `index.html`, `hud-btn` class, next to Research
  and Goals.
- Click handler in `src/main.js` alongside the other top-button handlers.
- A hotkey consistent with the existing scheme (check what is free — the digits and most
  letters are taken; grep the keydown switch before choosing) and add it to the
  hotkey-hint bar.
- Styling in `style.css` in the section convention used by the sibling windows.

## Step 4 — tests

- `test/test-economy-snapshot.js`: term sums, `net` equals the real funding delta over a
  tick, ring buffer capacity holds over a long run, and neither field appears in a save
  payload or an undo snapshot.
- Extend the browser suite with one case: open the panel from the button, assert it
  renders non-zero terms on a facility with a running beam, and close it.

## Notes

- Do not change any economy *value*. Phase 12 tuned them; this feature reports them.
  If a number looks wrong while building this, report it rather than adjusting it.
- The panel is a reader. It must not mutate game state.
