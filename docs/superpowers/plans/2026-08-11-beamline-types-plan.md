# Beamline Types — Implementation Plan

Spec: `docs/superpowers/specs/2026-08-11-beamline-types-design.md`

Ordering rule: data model and the type-selection flow first, then the types
whose physics already works, then the economy, then the types needing new
physics. Each wave leaves the tree runnable and `npm test` green.

Source studies (detail beyond this plan): `types-roster.md`,
`types-components.md`, `types-fom.md` in the session scratchpad.

---

## Wave 1 — data model, picker, palette filter, four live types

### 1a. `src/data/beamline-types.js` (new)

`BEAMLINE_TYPES` keyed by id, shape per spec §2. Populate all nine entries now
even though later waves activate them — the picker greys out what is not yet
gated open, and having the table complete keeps the integrity test honest.

Each entry needs: `id, name, tier, machineType, particle, spec, fom, fomRef,
bandWidth, requires, excludes, requiredEndpoint, blurb, accentColor`.

Export `getBeamlineType(id)` and `beamlineTypesFor(researchState)` (the unlocked
subset, for the picker).

### 1b. Component allowlists

Add the optional `beamlineTypes` array to components that are type-specific.
Omitted = trunk. Start from the trunk list in spec §3; the exhaustive coverage
matrix is in `types-components.md`.

Do NOT add allowlists to Infra/Structure/Grounds components — they are trunk by
construction and the filter only applies to `MODES.beamline`.

### 1c. Palette filter

`src/ui/hud.js:1697`, inside `_createPaletteItem`, next to the existing
`isComponentUnlocked` check. Hide when: the editing beamline has a type, AND
(the component declares `beamlineTypes` and this type is not in it, OR the type
declares the component in `excludes`).

Replace the long comment there explaining why the old `MACHINE_TIER` gate was
removed — this is the progression path it asked for.

Delete `MACHINE_TIER` from `src/data/machines.js` and drop the seven ids from
`UNIMPLEMENTED_CONTENT` in `test/test-registry-integrity.js` that exist only to
keep it alive. That test is self-cleaning and will name them.

### 1d. New Beamline picker

RCT2 ride-select analogue: a grid of type tiles, locked ones greyed with the
research node named. Follow the existing dialog idiom — `ContextWindow` or the
`WelcomeDialog`/`HiringDialog` pattern, whichever fits; do not invent new UI.

On confirm, the chosen type id is stored on the registry entry and its
`machineType` is written to `beamState.machineType`. Entry point: wherever
"new beamline" is initiated today (`Game._ensureBeamlineForSourcePlaceable`
creates registry entries lazily from a placed source — the picker must run
before or at that moment, and its result must reach `createBeamline`).

`BeamlineRegistry.createBeamline` already takes `machineType`; extend the entry
to carry `typeId` too, and serialise it (`toJSON`/`fromJSON`).

### 1e. `beam_physics/machines.py`

Nine configs, one per game type, with **explicit module lists per type** — not
the nested `_TIER1→_TIER4` chain. Add a `capabilities` set per config
(`{"fel"}`, `{"beam_beam"}`, `{"sr_light"}`).

Change `fel_gain.py` and `beam_beam.py` `applies_to` to test
`context`/config capabilities rather than machine-type string literals. Keep
`get_machine_config`'s unknown-type fallback to `linac`.

`lightSource` must NOT carry the `fel` capability.

**Acceptance:** every `BEAMLINE_TYPES[].machineType` resolves in
`MACHINE_TYPES`; a light-source config never runs `fel_gain`.

### 1f. The four live types

`testStand`, `ebeamProcessing`, `isotopeIrradiation`, `therapy`. These need no
new physics. `ebeamProcessing` needs one new component — a 2–20 MeV NC
structure (see `types-components.md`; a rescaled S-band variant is the cheapest
route) plus its `CAVITY_SPECS` entry in **both** `beam_physics/srf.py` and
`src/beamline/cavity-specs.js`, which `test/test-cavity-specs.js` cross-checks.

**Wave 1 acceptance:** a player can create each of the four, sees a filtered
palette, and the beamline's `machineType` reaches physics. Income is unchanged
(FoM scoring lands in Wave 2).

---

## Wave 2 — figures of merit and economy

### 2a. `src/game/figures-of-merit.js` (new)

`bandGate(x, lo, hi, w)` per spec §4 — 1 inside, `exp(-(d/w)²)` in decades
outside, one-sided when a bound is null.

One function per FoM, signature `(beamState, ctx) => number`, where `ctx`
carries what the beamState lacks (node counts by type, `continuousBeamTicks`,
port counts). Return raw FoM in its own units; scoring is separate.

`fomScore(type, beamState, ctx)` → `clamp(sqrt(fom / fomRef), 0, 2.5)`,
returning **1.0** when the type is unknown, the FoM is unimplemented, or the
result is not finite. That default is what keeps untyped and future beamlines
earning exactly as they do today.

Implement the five live FoMs (Test Stand, E-beam, Irradiation, Therapy,
Spallation). Leave the other four returning `null` → score 1.0.

### 2b. Economy

`src/game/economy.js`: `computeBeamIncomeBreakdown` gains an optional
`fomScore` (default 1.0) and `typeMult`, multiplying — **never replacing** the
`quality` term. See spec §5 for why; `test-convergence-regressions.js:290`
pins it.

Call site is `Game._tickBeamlineEconomy`, which already has the registry entry
and therefore the type.

### 2c. Balance

Build the reference machine for each live type in `scripts/balance-sim.mjs`,
measure its raw FoM, and replace the provisional `fomRef` with the measured
value. Then confirm:

- `smallBeamlineFacility` scores `fomScore ∈ [0.8, 1.2]`
- the three invariants in `test/test-economy-balance.js`
- run B stays net-positive, run C's upkeep fraction stays in 30–60%

Add a per-type companion to the node-spacing invariance test: two FoMs are
drift-length-sensitive, which the existing test does not cover.

---

## Wave 3 — XFEL and EUV FEL

- Wire `machineType` so `fel_gain` actually executes (the `undulator` component
  now exists; the capability set from 1e is the other half).
- Restore `cbandCavity` / `xbandCavity` as components — specs already exist in
  both cavity tables, so this is data only. Needed for XFEL affordability:
  17.5 GeV of `cryomodule` is $1.05B against a $592M research tree.
- `euvFel`: FoM is average photon power at 13.5 nm; needs the ERL framing but
  not ERL physics — an 800 MeV CW SRF linac is ~5 cryomodules.
- XFEL FoM multiplies by `min(1, saturation)²`.

**Watch:** `bunch_frequency` is hardcoded 1.3 GHz in `beam.py` and unreachable
from game data, yet it sets `n_particles` and `peak_current` — the two inputs
both tier-4 FoMs care most about. Fix as part of this wave.

---

## Wave 4 — Collider

- `positronSource` component; `'positron'` particle species in
  `beam_physics/constants.py`.
- `beam_beam.applies_to` keyed on the `beam_beam` capability and on
  `collisionPoint` rather than `'detector'`.
- Second-beam handling: two independently flattened beamlines converging on a
  shared `collisionPoint`. Read the opposing beam's state from the registry
  rather than trying to flatten both into one lattice.

---

## Wave 5 — Light Source

- `beam_physics/modules/synchrotron_light.py`, order 41 (immediately after
  `synchrotron_radiation`). Closed-form bending-magnet flux from `ρ = length/θ`,
  `E`, `I`; `E_c = 2.218 E³/ρ`, `⟨E_ph⟩ = 0.308 E_c`. No free parameters —
  should reproduce ~8.5e19 γ/s for a 4 GeV / 100 mA dipole. Hold it to the same
  calibration discipline as `srf.py`, with a pinned table.
- `photonPort` component. Note `Game.js:3603-3617` already has live user-fee and
  reputation code for it that nothing can currently reach.
- Ring abstraction: ploppable ring with a player-built linear injector and
  photon front ends. `flattenPath` emits one lap and stops **silently** — if
  the ring stays player-built instead, that needs an explicit error first.

---

## Cross-cutting

- Never commit; the user decides commit boundaries.
- `npm test` and `python3 -m pytest test/ -q` green after every wave.
- New components need `CAVITY_SPECS` entries in **both** tables when they are
  cavities, and utility ports in `utility-ports-v2.js` whenever they declare
  `requiredConnections` — the validator fails otherwise.
- Research nodes must advertise what gates them: a component with
  `requires: X` must appear in `RESEARCH[X].unlocks`, enforced bidirectionally
  by `test-registry-integrity.js`.
