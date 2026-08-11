# Economy Panel — design

**Date:** 2026-08-11 · **Status:** approved · **Branch:** `followups`

A draggable window, opened from a top-bar button, showing where the player's money
comes from and where it goes.

## Problem

The economy is the game's central pressure and it is almost entirely invisible. The
top bar shows a funding *balance*; nothing shows the *rate* or its composition. A
player whose funding is falling has no way to learn whether it is staff, the power
bill, reservoir refills, or simply that their beam is down.

This got worse with recent work: Phase 11 made utility hookups mechanically
necessary (an unwired sink now scores quality 0, which zeroes the beam income term),
and Phase 12 priced utility lines per sub-unit. Both are invisible in the current UI.

## The load-bearing constraint

`Game.tick()` calls `computeTickIncome()` and `computeTickUpkeep()`, applies the
result to `state.resources.funding`, and **discards the breakdown**. There is
nowhere to read it from.

The panel therefore displays **what was actually charged**, not a recomputation.
This is not a preference. Recomputing the same quantity at a second call site is
exactly the defect class closed in Phase 10 (`aggregates.js`) — it is how the HUD
came to quote a user fee 50× off from what was really paid, and how the facility
overview double-counted data rate, beam power and length. A panel whose whole
purpose is to be trusted must not reintroduce it.

## Design

### Data — `state.economySnapshot`

`tick()` records what it charged, in one place, at the moment it charges it:

- `income`: `{ grant, reputation, beam, dataFees, total }` — `beam` and `dataFees`
  are accumulated across running beamlines during the existing per-beamline loop.
- `upkeep`: `{ staff, power, pumps, refills, total }` — the first three come
  straight from `computeTickUpkeep()`'s existing return shape; `refills` is
  accumulated from reservoir refill events, which are *event* costs rather than
  per-tick ones and so are averaged over the history window for display.
- `net`, `tick`.

Derived, never serialized — it must not enter `SERIALIZED_FIELDS`, and it must be
excluded from undo snapshots (both already exclude by whitelist, so this is a
matter of not adding it).

### History — `state.economyHistory`

A fixed-capacity ring buffer of ~300 net-per-tick samples. Fixed capacity, so a
long game cannot grow it. Derived, not serialized. Reset on load.

### Capital spending

Per-tick flows do not explain the balance: one-off construction usually does. The
resource ledger added in Phase 10 (`_resourceLedger`) already attributes non-tick
spending. The panel surfaces a recent-capital total from it rather than adding a
parallel tracker.

### UI — `src/ui/EconomyWindow.js`

A `ContextWindow` subclass, matching `BeamlineWindow` / `EquipmentWindow`: one
instance (the registry dedupes by id), draggable, esc-stack aware, closed on
`destroy`. Opened by an `Economy` button in `#top-buttons` next to Beamline
Designer / Research / Goals, and by a hotkey consistent with the existing scheme.

Contents, top to bottom: net per tick with a sparkline of the history window;
income broken out by term with the number of contributing beamlines; expenses
broken out by term; a runway line (sustainable, or ticks-to-zero at the current
net); recent capital spend.

Refreshes on `tick`, cheaply — it reads a small prepared object, formats numbers,
and touches no game logic. It must unsubscribe on close (`Game.on` returns an
unsubscribe; the leak this prevents was fixed across four dialogs in Phase 1).

## Testing

- `economySnapshot` terms sum to their totals, and `net` equals `income.total -
  upkeep.total`.
- The recorded snapshot equals what funding actually moved by over one tick — the
  regression that makes the "display what was charged" rule enforceable rather
  than aspirational.
- The history buffer never exceeds capacity across a long run.
- `economySnapshot` / `economyHistory` appear in neither a save payload nor an undo
  snapshot.

## Out of scope

Charts beyond a sparkline; per-beamline profitability breakdown; projections; any
change to economy *values* — Phase 12 tuned those and this feature only reports
them.
