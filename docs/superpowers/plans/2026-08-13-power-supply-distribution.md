# Power supply → distribution — implementation plan

Spec: `docs/superpowers/specs/2026-08-13-power-supply-distribution-design.md`

Tasks 1–3 are the topology rules and stand alone. 4–7 are the power chain and
depend on 1–3. Commit boundaries marked — three commits.

---

## Task 1 — `worldState` reaches the solvers

**Files:** `src/game/utility-gate.js`

`runSolve({ tick: state.tick })` → `runSolve(state)`. `state.tick` is already on
the object, so `worldState.tick` readers are unaffected.

**Acceptance:** `vacuumPipe.solve` sees placeables and beam pipes; bakeout and
beam-pipe outgassing become live.

**Expect fallout:** vacuum gets harder. The scenario suite asserts the starter
facility pumps down; if it now doesn't, the scenario is under-pumped and gets
another pump — do NOT relax the physics to make the test pass.

## Task 2 — What a shared subtile means

**Files:** `src/utility/line-drawing.js`, `src/utility/network-discovery.js`,
`src/utility/types/*.js`

- Descriptors declare `allowsTap` (cooling / vacuum / cryo true; power, RF,
  data, hvCable false).
- `pathOverlapsSameType` classifies each shared subtile instead of rejecting it:
  compute the local direction of each run at that subtile from its expanded
  path; perpendicular + interior-to-both = crossing, permitted. Collinear =
  reject. Endpoint-of-one = permitted only under the existing tap/fanout
  exemptions.
- `discoverNetworks`' spatial union narrows to endpoint contact: two lines merge
  only when a shared subtile is an END of at least one of them AND the utility
  allows taps (or it is the shared-source fanout case, unchanged). A crossing
  must not merge.

**Acceptance:** perpendicular crossings commit and stay separate networks;
running down a trunk still rejects; existing tap behaviour unchanged for fluids
and gone for power.

**Test:** extend `test/test-utility-line-tap.js` — crossing commits and yields
two networks; collinear still `overlap_same_type`; a power drag onto a power
line offers no tap.

## Task 3 — Outlets are countable

**Files:** `src/utility/ports.js`, `src/utility/line-drawing.js`,
`src/utility/types/*.js`, `src/input/utility-run-wiring.js`

- Descriptors declare `fansOut` (true for the fluid utilities, false for
  `powerCable` and `hvCable`).
- `availablePorts`' claimed-port exemption becomes conditional on it;
  `validateDrawLine`'s matching `spec.role !== 'source'` check likewise. Both
  need the utility descriptor, which they can reach via the registry.
- `planUtilityRun` stops assuming one source port serves every stub: it walks
  the anchor placeable's free outlets in order and stops when they run out,
  reporting the remainder through the existing `skipped` count.

**Acceptance:** a claimed power outlet stops being offered; a fifth machine on a
4-way panel has no port to grab; shift-drag wires up to the outlet count.

> **Commit 1:** tasks 1–3 (`feat(utility): crossings, taps and countable ports`).

---

## Task 4 — The `hvCable` utility

**Files:** new `src/utility/types/hvCable.js`, `src/utility/registry.js`,
`src/data/utility-ports-v2.js`

- Descriptor: black (`#1a1a1a` with a light spec so it reads against dark
  floor), `geometryStyle: 'cylinder'`, radius ~0.05 (visibly heavier than a
  branch cable), `costPerSubUnit` above `powerCable`'s 600 — 1200, between
  cooling and vacuum on the existing ladder. `allowsTap: false`,
  `fansOut: false`, `bridgesAdjacent: false` (bolting two panels together does
  not make an HV tie).
- `solve`: same shape as `powerCable` — sum supply capacity against the
  connected distribution devices' declared draw; hard error when a distribution
  device has no supply, soft when the HV network is over capacity.
- Registered BEFORE `powerCable` in the list so a panel's gate reads this
  tick's result.
- Quality field: extend `UTILITY_TO_QUALITY_FIELD` so an unfed panel fails
  closed like every other declared sink.

## Task 5 — Retag the components

**Files:** `src/data/infrastructure.raw.js`, `src/data/utility-ports-v2.js`

| type | becomes | ports |
|---|---|---|
| `hvTransformer` | supply | 4 × `hv_out` (source, 1200 kW total) |
| `switchgear` | supply | 2 × `hv_out` (400 kW) |
| `padMountTransformer` | supply | 1 × `hv_out` (150 kW) |
| `powerPanel` | distribution | `hv_in` (sink) + 4 × `pwr_out` |
| `mcc` | distribution | `hv_in` + 8 × `pwr_out` |
| `ups` | distribution | `hv_in` + 2 × `pwr_out` |
| `powerBus` | distribution | `hv_in` + its 4 existing bus faces |

Port sides: outlets distributed around the footprint rather than stacked on one
face, so a panel can be approached from more than one direction (the port
anchors from the previous overhaul already place them on the model).

**Acceptance:** `test-components-utility-ports` and `test-content-validate`
pass; every distribution type declares exactly one `hv_in`.

## Task 6 — A panel delivers only what it is fed

**Files:** `src/utility/types/powerCable.js`

`solve` scales each source port's capacity by the quality its owning placeable's
HV sink last recorded (`worldState.nodeQualities[placeableId]`), defaulting to 1
for a placeable with no HV sink (i.e. a genuine supply, if any remain wired
direct). Zero quality → zero capacity → the existing `power_starved` hard error
fires on the branch network, which is the correct reading: the machines on that
panel are dead.

**Test:** new `test/test-power-chain.js` — supply → panel → machine is powered;
cutting the HV run kills the branch; capacity is the supply's, not the sum of
panel ratings; two panels off one transformer share its capacity and overload it
together.

## Task 7 — Content, scenarios, wiki

**Files:** `src/data/scenarios/*.js`, `src/data/wiki/*`, `src/ui/hud.js`

- Re-wire `smallBeamlineFacility` and `realLab`: transformer → HV → panel(s) →
  machines. Their current wiring cables machines straight to sources and will
  trip.
- Utility legend gains HV (black swatch).
- Wiki: the utility-model page describes the two-stage chain and the
  tap/crossing rule.

> **Commit 2:** tasks 4–6 (`feat(power): HV supply feeding distribution panels`).
> **Commit 3:** task 7 (`content: re-wire scenarios for the power chain`).

---

## Risks

- **Task 1 changes vacuum balance.** It is a bug fix, but it lands as a
  difficulty change. Measure the starter scenario's pressure before and after
  and say so in the commit.
- **Task 3 is the invasive one.** `fansOut: false` makes every previously-legal
  fan-out illegal; anything in content or tests that wires N machines to one
  port breaks and must be re-wired rather than exempted.
- **Two power tools in the palette.** If HV and branch cable read as
  interchangeable to the player, the split has failed — the black trunk has to
  look like trunk. Check it at normal zoom before calling task 4 done.
