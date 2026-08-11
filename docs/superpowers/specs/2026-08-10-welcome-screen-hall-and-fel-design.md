# Welcome screen: hall wall, FEL beamline, campus traffic, unified ranch gag

Date: 2026-08-10
Scope: `src/ui/TitleScreen.js` only (plus a screenshot helper for verification).

## Problem

The title-screen scene reads as one continuous poured concrete plane from y=196
to y=302. Perspective already implies the control room and cafe are *behind*
the beamline, so the dark upper band (y 196–230) should read as the **back wall
of the beamline hall**, not as more floor. Today it doesn't:

- Utility lines are painted straight across the band from the equipment down to
  the beam pipe, tying the two planes together.
- The RF rack, cryo dewars and vacuum pump skid have their feet *on* the band,
  so they appear to stand on a vertical surface.
- Benches, flower pots and a lamppost float on the band for the same reason.
- Vertical slab seams run continuously through both bands.

Separately: the beamline lattice is a generic transport line (quads, RF, dipole,
BPM, Faraday cup) rather than the FEL the game is about; the control room has a
standing figure that overlaps the shared wall; there is no reason for people to
travel between the buildings and the hall; and the left side of the scene runs
two unrelated slapstick events (car-hits-cow, cows-break-fence) that would land
better as one causal chain.

## Design

### 1. Hall wall

The band at y 196–230 is repainted as a wall:

- 1px lighter coping at y=196.
- Vertical panel joints every 48px spanning **y 197–229 only**.
- 2px darker dado at y 227–229, and a 1px contact shadow at y=230 on the floor
  side.
- The light slab (y 230–302) keeps vertical seams on an **independent** grid
  (48px pitch, 24px offset) spanning y 231–301, so the two planes no longer
  share seam positions.

All three `_utilLine` calls are removed. Nothing is painted across the wall face.

`_drawSupportEquip` moves its base line from **230 → 240**. Bodies still rise to
y≈214 and overlap the wall, so the plant reads as standing *against* it, but
every footprint is fully on the light floor. Each unit gets a 1px floor contact
shadow.

Benches move to the hall floor flanking the doorway (foot y≈292). Flower pots
follow them. The two lampposts are replaced by wall-mounted hall lights on the
dark wall, which give the night palette a light source in the hall.

### 2. Doorway and hallway

A doorway is punched in the wall, centred at **x ≈ 385** (`bldX + 68`), spanning
x 374–396, y 200–230. That x is directly under the control room's own exterior
door and lands between the two benches' former positions.

Inside the opening, a receding corridor: floor trapezoid rising to a small lit
far-end panel, two-tone side walls, a ceiling strip with light panels. A warm
light-spill fan is drawn on the hall floor in front of the opening.

Above y=196 a short flat-roofed connector stub links the opening back to the
control room base, so the corridor reads as depth rather than a painted
rectangle.

### 3. FEL beamline

Straight-through — no dipole. Target block widens from 30 to 40px.

Left to right:

| Element | Notes |
| --- | --- |
| Injector | existing source cabinet, plus a photocathode-laser hint (violet box, 1px beam into the gun) |
| Quad (F) | |
| SRF cryomodule A | ~52px silver-blue vacuum vessel, domed ends, cavity cells hinted through a cutaway stripe, cryo port on top, RF coupler underneath |
| Quad (D) | poles rotated so F/D alternation is visible |
| SRF cryomodule B | as A |
| Quad (F) | |
| BPM | existing small diagnostic ring |
| Undulator | ~100px: two magnet girders with alternating red/blue pole blocks, beam gap between them, gap-drive screw columns at each end |
| Semiconductor scanner | wafer on an XY stage that steps between pulses, detector head, readout screen filling in a scan raster |

Services replace the removed branches, routed at floor level (y 234–244) and
rising into their component — never across the wall face:

- Helium dewars → **jacketed cryo transfer lines** (2px with periodic bellows
  ticks) into each cryomodule's top cryo port.
- Klystron rack → **brass rectangular waveguide** into each cryomodule's RF
  coupler.
- Vacuum pump skid relocates to the undulator end with a short vacuum line.

Beam: a cyan electron bunch runs gun → undulator exit, then converts to a faster
white/violet **photon** pulse for the undulator → scanner leg. The cash pop on
scanner arrival reads **`+$1,000`** (title screen only; the game economy is
untouched).

`_drawDipole` and `_drawRF` are deleted. Component ids become
`quad0 / srf0 / quad1 / srf1 / quad2 / bpm / undulator / scanner`, and
`_startMishap`'s preferred-target filter updates to `srf0 | srf1 | undulator`.

### 4. People, office, commuters

- The standing supervisor at the right of the control room interior is removed.
- `this._doors` collapses to a single **hall door**. Entering becomes a real
  animation: walk to x≈385, then foot lerps 276 → 232 over ~0.9s while fading
  out. Spawning reverses it. Door probability in `_decide` goes 0.12 → 0.16.
- New `_drawOffice` at x 246–312, left of the control room and clear of the
  parking lot (which ends at x=241): two-storey flat-roof block, ADMIN sign, lit
  window rows, roof HVAC, door at the right end.
- New lightweight `_commuters` list. When a car reaches `parked`, a commuter
  steps out at the stall and walks the lawn walkway (foot y≈193) to the office
  door; ~30% carry on to the control-room door. Occasionally one leaves the
  office, walks to a parked car, and that car then drives off.

### 5. Unified ranch gag

`_crash` and `_cowEvent` merge into one `_ranchEvent` machine on a single timer:

```
lure → approach → tumble → burn      (car hits cow, wreck cartwheels, driver bails)
     → panic                          (remaining herd bolts back and forth, "!" bubbles)
     → breakout                       (2–3 shove through the fence onto the lawn)
     → chase                          (guard bolts from the booth)
     → bowled                         (a cow charges into him; knocked flying, cap off, stars)
     → down → recover
     → draw                           (stands, "!", then muzzle flashes with 1px tracers, one per cow)
     → ghosts                         (each cow blinks out; a cow ghost rises and drifts over the fence, fading)
     → return                         (holsters, walks back to the booth; fence repairs, wreck fades)
     → restock                        (10–20s later, new cows fade in at the horizon and amble down into the herd)
```

Tone stays in the same cartoon register as the existing ghost-employee gag:
muzzle puff, cow blinks out, ghost floats off. No blood, no bodies.

`window.__titleFx.crash()` and `.cowEvent()` remain as aliases onto the new
machine so existing debug muscle memory keeps working.

## Addendum (same day, after first implementation pass)

Two revisions landed after seeing the result in place.

### 6. The doorway is flat

The doorway shipped with a one-point-perspective corridor (receding side walls,
ceiling and floor trapezoids, a lit far-end panel, a 45° light-spill fan). That
was rejected: *"there can be no perspective, just show a door and occasionally
people walk through it."*

It is now a face-on door — cast jambs, lintel, a lit transom, two leaves folded
back against the jambs, a threshold plate, and a constant-width warm rectangle
of light on the floor. No trapezoids, no vanishing point. Geometry is unchanged
(`_hallDoorX`, 22px wide, y 200–230) so the people-transit animation still
lines up.

### 7. One building, not three

`_drawOffice` / `_drawControlRoom` / `_drawCafeteria` are replaced by a single
`_drawCentralLab` (plus `_labRoof`, `_labAdminBay`, `_labControlBay`,
`_labLobbyBay`, `_labCafeBay`, `_labEntrance`, `_labSign`, `_labCafeSign`).

The facility is modelled on SLAC: the **Central Laboratory (Building 40)** for
the block itself — long, low, mid-century, warm pale tan concrete, a strongly
regular structural bay rhythm, ribbon window bands, flat roof with a parapet and
cluttered rooftop plant — and the **Klystron Gallery** for the insistence on one
unbroken low roofline rather than three stacked boxes.

216px wide at `bldX - 68`, 12 bays on an 18px pitch, positioned so bay 7's centre
lands exactly on `hallDoorX` and the main entrance sits directly above the hall
door. Interiors are preserved and re-housed left to right as one facility: admin
→ west entrance → control room (the three EPICS consoles) → main entrance →
cafeteria. `CENTRAL LAB` parapet plate in red-on-cream; the amber `CAFE` sign
stays over the cafe bays.

`_palette` gains warm-concrete stops `conc` / `concT` across all four keyframes.
The warm block also reads better against the cold grey hall wall below, which
reinforces the depth separation this whole rework was after.

Preserved contracts: `_hallDoorX`, `_doors = [_hallDoorX]`, `_ctrlDoorX` (now the
main entrance) and `_officeDoorX` (now the west entrance).

### 8. Facade rebuilt as composed massing

The first unified building was one 216px slab divided into 12 identical 18px
bays behind heavy mullions — at zoom it read as a vending machine, and the
control room's screens sat at second-floor height spread one per bay.

Replaced with five connected volumes of differing height and depth, 272px total
(x 230–502), laid out from `hallDoorX` so the main entrance stays above the hall
door:

| Volume | span | roof y |
| --- | --- | --- |
| Office wing | 230–302 | 156 |
| Control room (tallest, steps forward) | 302–374 | 146 |
| Entrance link (lowest, steps forward) | 374–396 | 166 |
| Cafeteria pavilion | 396–470 | 160 |
| Services / stair end | 470–502 | 164 |

Glazing is continuous ribbon bands with 1px mullions, with band heights and
mullion pitch varying per volume. Rooftop plant differs per volume. The visitor
lot drops from 4 stalls to 3 (`lotW` 86 → 65) to make room.

The control room is now one double-height space: a 4×2 tiled video wall above,
and at floor level a continuous console with 7 monitors edge to edge and 7
operators shoulder to shoulder — the "trader's desk" read the user asked for.
Nothing sits at second-floor height in that room.

### 9. Undulator emission, beam dump, chip conveyor

- **Lasing is legible.** The bunch follows a sinusoid matching the 3px pole
  pitch inside the gap, throwing violet streaks forward from each wiggle crest.
  Emission stride tightens and alpha ramps 0.14 → 0.80 along the girders, so FEL
  gain is visible; the exit bar is brighter than the bunch that entered.
- **Spent-beam dump.** An extraction dipole past the undulator exit kicks the
  spent electrons down a short branch pipe into a shielded dump — dark stepped
  concrete courses, diagonal hazard striping on a corner, an 11×10 black-on-yellow
  radiation trefoil, a subtle green glow that flares on arrival. The photon pulse
  continues on-axis to the scanner, so the eye can follow light and electrons
  separately. An energy-recovery return line was considered and dropped: at this
  width it would be cramped and unreadable.
- **Chip conveyor.** A belt runs out of the scanner's underside 104px left along
  y ≈ 291 to a crate. A chip drops on each scanner arrival, in step with the
  `+$1,000` pop. The benches moved to `hallDoorX - 152 / - 96` to clear it.

## Non-goals

- Save-file compatibility (pre-release, single user).
- Any change to the game's real economy or beamline simulation.
- Reworking the UFO event, which stays independent (it already refuses to run
  while another cow-borrowing event is active).

## Acceptance

- The dark band reads as a wall: no lines crossing it, no props or equipment
  feet on it, seams that stop at y=230.
- A visible doorway with corridor depth sits between the former bench positions.
- The lattice reads as an FEL: injector, two SRF cryomodules with alternating
  quads, a long undulator, a wafer scanner; cryo and RF services visibly connect
  the plant to the cryomodules at floor level.
- `+$1,000` pops on each pulse arrival.
- Scientists visibly walk into and out of the hall doorway; commuters walk from
  parked cars into the office.
- The left-side gag runs as one causal chain from car crash through to the herd
  being restocked over the hill.
- `npm test` passes; the scene renders without console errors.
