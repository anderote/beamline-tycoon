# Plan: welcome-screen hall wall, FEL beamline, campus traffic, unified ranch gag

Spec: `docs/superpowers/specs/2026-08-10-welcome-screen-hall-and-fel-design.md`
Target: `src/ui/TitleScreen.js` (single file — tasks run **sequentially**, not in parallel).

Scene constants that everything below depends on: `H = 320`, `W = round(320 * aspect)`
(512 at 16:10). `padTop = 196`, `padMid = 230`, `padBot = 302`. `bldX = floor(W * 0.62)`
(317 at W=512). Beam axis `pipeY = 254`, component base `groundY = 272`, people walk
line `foot ≈ 276`.

Verification for every task: `npm test`, plus a title-screen screenshot against the
user's dev server on :8000 (do **not** start or stop a dev server).

---

## Task 1 — Hall wall, doorway, equipment reseat, props

Region: `_draw` (~735–770), `_drawSupportEquip`, `_utilLine`, `_drawBench`,
`_drawFlowerPot`, `_drawLamppost`.

1. Extract the pad painting in `_draw` into `_drawHallWall(ctx, W, pal)` +
   `_drawHallFloor(ctx, W, pal)`. Wall gets: coping line at `padTop`, panel joints
   every 48px spanning `padTop+1 .. padMid-1`, a 2px dado at `padMid-3 .. padMid-1`,
   and a 1px contact shadow at `padMid`. Floor gets its own seams on a 48px pitch
   offset by 24px, spanning `padMid+1 .. padBot-1`. The two grids must not line up.
2. Delete the three `_utilLine(...)` calls in `_drawBeamline`. Keep `_utilLine`
   itself for now; Task 2 decides whether it survives.
3. `_drawSupportEquip`: `base` 230 → **240**. Add a 1px
   `rgba(0,0,0,0.35)` contact shadow under each unit's footprint.
4. New `_drawHallDoor(ctx, x, pal, t)` — opening 22 wide × 30 tall, top at
   `padTop + 4`, bottom at `padMid`. Contents: 1px lintel, receding corridor
   (floor trapezoid rising to a lit far-end panel, two-tone side walls, ceiling
   strip with 2 light panels), and a light-spill fan on the floor below the
   opening (alpha ~0.10, ~28px wide, ~11px deep). Door x is `bldX + 68`; store it
   as `this._hallDoorX` for Task 3.
5. Above `padTop`, draw a flat-roofed connector stub (~16px wide, ~6px tall) from
   the doorway up to the control-room base so the corridor reads as depth.
6. Move the two `_drawBench` calls to the hall floor flanking the doorway
   (roughly `hallDoorX ± 34`, baseY ≈ 292) and re-site the flower pots beside
   them. Replace the two `_drawLamppost` calls with a new
   `_drawWallLight(ctx, x, y, pal)` — a small fixture on the wall face with a
   night-only glow cone spilling down onto the floor.

Acceptance: nothing is drawn across y 196–230 except the wall itself, the
doorway, the wall lights, and equipment *bodies* whose feet are below y=230.

---

## Task 2 — FEL beamline

Region: `_drawBeamline`, `_beamGeom`, `_equipPositions`, `_drawQuad`, `_drawRF`,
`_drawDipole`, `_drawBPM`, `_drawCashPop`, `_startMishap`.

1. `_beamGeom`: `tgtW` 30 → **40**.
2. Delete `_drawDipole` and `_drawRF`. Add:
   - `_drawCryomodule(ctx, x, pipeY, groundY, t, i)` — ~52px silver-blue vessel
     straddling the pipe, domed end caps, a cutaway stripe showing 3 copper cavity
     cells, a cryo port stub on top, an RF coupler stub on the bottom-left, two
     support posts down to `groundY`, slow-blink status LED.
   - `_drawUndulator(ctx, x0, x1, pipeY, groundY, t)` — top and bottom girders with
     alternating red/blue pole blocks (3px pitch), beam gap between them,
     gap-drive screw columns at each end, support legs. Emits a faint glow inside
     the gap while the bunch is passing.
   - `_drawScanner(ctx, x, y, w, t)` replacing the Faraday-cup block — entrance
     snout, wafer disc with a flat on an XY stage that steps position between
     pulses, detector head, readout screen filling in a scan raster.
3. `_drawQuad` gains an `fd` argument: rotate the pole highlight (horizontal vs
   vertical) so alternation is visible.
4. New lattice across `span = pipeEnd - pipeStart`, using the existing
   `px(f)` helper:
   `quad0 @0.05, srf0 @0.17, quad1 @0.30, srf1 @0.42, quad2 @0.55, bpm @0.60,
   undulator @0.65–0.93`, scanner at `tgtX`. Component registry ids follow.
   Keep the compact stands loop, skipping the undulator (it has its own legs).
5. Add a photocathode-laser hint at the injector: small violet box left of / above
   `srcX`, 1px beam into the gun face.
6. Services (replacing the deleted `_utilLine` runs). Reposition the dewars near
   the SRF section and the pump skid near the undulator end via `_equipPositions`,
   then add:
   - `_drawCryoLine(ctx, x1, x2, y, portX)` — 2px jacketed run at floor level
     (y ≈ 238) with bellows ticks every 6px, rising into each cryomodule's top
     cryo port.
   - `_drawWaveguide(ctx, x1, x2, y, portX)` — 2–3px brass rectangular run from
     the klystron rack to each cryomodule's RF coupler.
   - a short vacuum line from the pump skid to the pipe near the undulator.
   All service runs stay in `y 234–244` before rising. Delete `_utilLine` if it
   ends up unused.
7. Beam: keep the cyan electron bunch from `pipeStart` to the undulator exit, then
   hand off to a faster white/violet photon pulse from undulator exit to the
   scanner. `this._beamX` must keep tracking the visible pulse (the zap gag reads
   it).
8. `_drawCashPop`: `+$100` → `+$1,000` (add a comma glyph; 7 glyphs at 4px pitch).
   Update the two comments that name `+$100`.
9. `_startMishap`: preferred-component filter `'rf' | 'dipole'` → `'srf0' | 'srf1'
   | 'undulator'`.

Acceptance: lattice reads as an FEL; cryo and RF services visibly connect plant to
cryomodules at floor level; `+$1,000` pops on each arrival; no dangling references
to the deleted ids anywhere in the file.

---

## Task 3 — Control room, hall-door pedestrians, office, commuters

Region: `_drawControlRoom`, `_draw`, `_initFx`, `_fxFrame`, `_updatePerson`,
`_decide`, `_drawPerson`, `_roadFrame`.

1. Delete the standing supervisor `_drawTinyPerson(ctx, ix + iw - 4, ...)` call in
   `_drawControlRoom`.
2. Replace `this._doors = [controlDoorX, cafeDoorX]` with the single hall door
   from Task 1. Keep `this._doors` as a one-element array so existing call sites
   keep working, and add `this._hallDoor = { x, y: padMid }`.
3. Person door transit. In `_updatePerson`, when a `walk` with
   `pendingWork.kind === 'enter'` arrives, switch to a new `'door'` state instead of
   returning `'gone'` immediately: over ~0.9s lerp `s.foot` 276 → 232 and
   `s.doorFade` 1 → 0, then return `'gone'`. Spawned-from-door scientists start in
   `'door'` reversed (`foot` 232 → their walk line, fade 0 → 1) before entering
   `walk`. `_drawPerson` honours `s.doorFade` via `globalAlpha`.
4. `_decide`: door probability 0.12 → 0.16.
5. New `_drawOffice(ctx, bx, groundY, t, pal)` at `bx = bldX - 71` (≈246, width 66,
   clear of the parking lot which ends at x≈241). Two-storey flat-roof block in the
   control-room tone family, ADMIN sign, two rows of lit windows, roof HVAC box,
   exterior door at the right end. Call it from `_draw` before the control room and
   return its door x.
6. Commuters. Add `this._commuters = []` in `_initFx`, updated and drawn from
   `_fxFrame` (drawn after the buildings, before the pad, at foot y≈193 on the lawn
   walkway):
   - When a car transitions to `parked` in `_roadFrame`, push a commuter at
     `(spot.x + 8, foot 190)`.
   - Commuter walks right to the office door x; ~30% then continue to the control
     room door x; on arrival they are removed.
   - Occasionally (every ~20–35s, if a car is parked) emit a reverse commuter from
     the office door that walks left to that car's stall; on arrival set the car's
     `leaveAt = 0` so it departs.
   - Draw with `_drawTinyPerson` (walk pose).

Acceptance: scientists visibly step into and out of the doorway rather than
vanishing mid-floor; commuters make the car → office trip; no console errors.

---

## Task 4 — Unified ranch gag

Region: `_startCowEvent`, `_updateCowEvent`, `_drawCowEvent`, `_startCrash`,
`_updateCrash`, `_endCrash`, `_drawCrash`, `_drawGuard`, `_updateCow`, `_initFx`,
`_fxFrame`, `EVENT_TIMING`.

1. Merge the two machines into `this._ranchEvent`, built by `_startRanchEvent(t, W)`,
   advanced by `_updateRanchEvent(t, dt, W)`, drawn by `_drawRanchEvent(...)` — but
   keep the existing per-phase drawing helpers (wreck, flames, driver, guard, cows)
   rather than rewriting them. One timer `this._nextRanchAt`; `EVENT_TIMING` keeps
   `crashFirst`/`crashGap` values under new names `ranchFirst`/`ranchGap`. Delete
   `this._nextCowEventAt` and its scheduling block in `_fxFrame`.
2. Phase chain (reusing existing phase bodies where they already exist):
   `lure → approach → tumble → burn → panic → breakout → chase → bowled →
    down → recover → draw → ghosts → return → restock`.
   - `burn` shortens to ~4s so the chain doesn't stall.
   - `panic` (new, ~2.2s): every non-escaped herd cow runs at ~3× speed, flipping
     direction on a short random timer, with `!` bubbles; they drift toward
     `breakX`.
   - `breakout` reuses the existing body but takes its escapees from the panicked
     herd (2–3 cows).
   - `bowled` replaces `trip`: the nearest cow charges the guard; he is knocked
     along `dir` with an arc, lands flat, cap off, stars (reuse the existing `down`
     pose art).
   - `draw` (new, ~1.8s): guard stands, `!` bubble, then one shot per escaped cow
     on a ~0.45s cadence — 3-frame muzzle flash plus a 1px tracer to the cow.
     Needs a new `'draw'` pose in `_drawGuard` (arm extended, small pistol block).
   - `ghosts` (new, ~2.4s): each shot cow stops drawing; push a cow ghost into a new
     `this._cowGhosts` list, drawn by `_drawCowGhost` (white wobbly body, horn nubs,
     tail wisp) drifting up and over the fence while fading.
   - `return` reuses the existing body; fence repairs here and the wreck fades.
   - `restock` (new): after 10–20s, fade in replacement cows at the horizon line
     behind the ranch band and amble them down into the herd band, restoring
     `_cowsFG` to its original count. Then the event ends and `_nextRanchAt` is
     rescheduled.
3. Safety: keep `_endCrash`'s "never strand a cow off-herd" guarantee — on any
   early termination, all borrowed cows are returned with `escaped/held` cleared.
4. Debug hooks in `_initFx`: add `ranch: () => this._startRanchEvent(...)` and keep
   `crash` and `cowEvent` as aliases onto it. `debug()` reports the ranch phase.

Acceptance: `window.__titleFx.ranch()` runs the whole chain end to end without the
scene locking up, cows always return to the herd, and the herd count is restored
after `restock`.

---

## Task 5 — Verification pass

1. `npm test`.
2. Screenshot the title screen against the user's :8000 dev server; confirm the
   wall, doorway, FEL lattice and `+$1,000` visually.
3. Drive `window.__titleFx.ranch()` and sample frames through the chain; confirm no
   console errors and that `debug()` shows the herd restored at the end.
4. Report anything that could not be verified.
