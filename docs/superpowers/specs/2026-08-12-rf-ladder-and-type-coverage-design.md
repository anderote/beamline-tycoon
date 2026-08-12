# RF Ladder & Beamline-Type Component Coverage

**Date:** 2026-08-12
**Status:** Approved for planning

## Problem

Beamline types filter the build palette (`beamlineTypeHidesComponent`, `src/ui/BeamlineTypePicker.js:127`). An audit of all nine types against the 45 beamline-category components found the filter itself is sound — no orphaned components, no dangling ids in `excludes` or `beamlineTypes`, every type has a source, an RF structure and a `requiredEndpoint` in its palette — but four types **cannot reach their own `spec.energyGeV` band** with any sane number of placements, and several unlock before the hardware that defines them.

Measured placement counts to reach band top, at full research:

| Type | band (GeV) | best structure | placements |
|---|---|---|---|
| spallation | 0.8–3.0 | `spokeCavity` @ 0.01 | **80–300** |
| collider | 45–120 | `cryomodule` @ 0.2 | **220–595** |
| xfel | 6–17.5 | `cryomodule` @ 0.2 | 30–83 |
| lightSource | 2.5–6 | `cryomodule` @ 0.2 | 13–30 |

Spallation is the sharpest case: its palette holds no high-β accelerating structure at all. Real spallation linacs (SNS, ESS, PIP-II) use β=0.61–0.86 elliptical SRF cavities at 650/805 MHz for exactly the 0.2→1 GeV section, and `ellipticalSrfCavity` / `cryomodule` are allowlisted to the four electron types only. The header note in `beamline-components.raw.js:21-27` justifies the split with "a 70 MeV proton (β=0.37) arrives at each gap with the wrong phase" — correct at 70 MeV, but at 800 MeV a proton is β=0.84 and elliptical cavities are the right hardware. The physics justification stops holding precisely where spallation starts.

## Governing principle

**One RF placement is a cryostring or sector, not a single cavity. Cost tracks energy; footprint does not.**

An upgraded module costs roughly what the many basic modules it replaces would have cost, so research buys *compactness* rather than making energy free. This is what makes a TeV-class machine placeable on a finite map without trivialising it.

Two constraints bound the ladder:

1. No consecutive rung may exceed ~3× the previous, so progression reads as a ladder rather than a cliff.
2. The top rung replaces ~75 cryomodules, not 200.

Placement counts are **not** uniform across types. A tier-3 spallation source is a 10–20 placement build; a 1 TeV collider is ~33 placements per arm, and should feel like it.

## The RF ladder

New entries in **bold**. Costs are provisional — see Calibration.

| GeV/place | id | family | cost | $/GeV | research |
|---|---|---|---|---|---|
| 0.0005 | `pillboxCavity` | NC trunk | $0.2M | — | existing |
| 0.001 | `halfWaveResonator` | SC p, β0.1 | $0.4M | — | existing |
| 0.01 | `spokeCavity` | SC p, β0.5 | $0.6M | — | existing |
| 0.045 | `rfCavity` | NC e, 1.3 GHz | $0.5M | — | existing |
| 0.051 | `sbandStructure` | NC e, 2856 MHz | $0.6M | — | existing |
| **0.12** | **`cbandStructure`** | NC e, 5712 MHz, 40 MV/m | $6M | $50M | `highGradientRf` |
| **0.15** | **`srf650Cryomodule`** | SC p, β0.61, 650 MHz | $9M | $60M | `cwLinacDesign` |
| 0.20 | `cryomodule` | SC e, 1.3 GHz | $12M | $60M | existing |
| **0.30** | **`xbandStructure`** | NC e, 11424 MHz, 100 MV/m | $14M | $45M | `highGradientRf` |
| **0.40** | **`srf805Cryomodule`** | SC p, β0.86, 805 MHz | $20M | $50M | `superconducting` |
| **0.50** | **`cwCryomodule`** | SC e, CW 1.3 GHz | $22M | $44M | `cryomoduleDesign` |
| **1.2** | **`nbSnCryomodule`** | Nb₃Sn, 4.5 K | $42M | $35M | `nDopedSrf` |
| **3.5** | **`srfLinacSector`** | SC e cryo-sector | $91M | $26M | `colliderTech` |
| **6** | **`twoBeamModule`** | CLIC drive-beam | $126M | $21M | `highLuminosity` |
| **15** | **`plasmaAfterburner`** | plasma wakefield | $255M | $17M | `plasmaAcceleration` |

`$/GeV` falls from $60M to $17M across the ladder: research makes large machines affordable, which is both how it works in reality and better game feel than penalising the upgrade.

### Non-RF components

| id | physicsType | subL | cost | serves | research |
|---|---|---|---|---|---|
| **`fastKicker`** | `dipole` | 4 | $2.5M | lightSource, collider | `storageRingTech` |
| **`recirculationArc`** | `chicane` | 12 | $18M | euvFel, lightSource | `energyRecovery` |
| **`finalFocusDoublet`** | `quadrupole` | 6 | $35M | collider | `highLuminosity` |

`fastKicker` closes a real gap: `lightSource` is the only ring in the roster and has `injectionSeptum` but no kicker. Ring injection is septum **and** fast kicker; `scanningMagnet`, the only `fastKickers` component, is allowlisted to the three proton types.

## Research homing

**Twelve new components, zero new research nodes.** 44 of 69 nodes in `src/data/research.js` currently have an empty `unlocks` array, including a complete but unpopulated RF/SRF subtree — `highGradientRf`, `superconducting`, `nDopedSrf`, `cryomoduleDesign`, `cwLinacDesign`, `energyRecovery`, `storageRingTech`, `highLuminosity`, `colliderTech`. Each new component homes on the node that already gates the type needing it.

`test/test-registry-integrity.js:319` enforces symmetric gating in both directions — a node must advertise what it gates, and a gated component must be advertised — with `KNOWN_OPEN_GATING` deliberately empty. Every new component must therefore appear in exactly one node's `unlocks` **and** carry that node in its `requires`.

This also closes the "research node that unlocks nothing" problem for seven nodes as a side effect.

## Resulting builds

| Type | band (GeV) | typical structure | placements |
|---|---|---|---|
| spallation | 0.8–3.0 | 650 → 805 MHz β-ladder | 10–20 |
| lightSource | 2.5–6 | `cwCryomodule` | 5–12 |
| euvFel | 0.8–1.2 | `cwCryomodule` (CW is correct for an ERL) | 2–3 |
| xfel | 6–17.5 | `nbSnCryomodule` | 5–15 |
| collider (base) | 45–120 | `srfLinacSector` / `twoBeamModule` | 8–34 |
| collider (1 TeV CoM) | 500/beam | `plasmaAfterburner` | 33 per arm |

The proton β-ladder is the design's best teaching moment: 650 MHz medium-β followed by 805 MHz high-β is literally how SNS and PIP-II are laid out, so the optimal spallation build reproduces the real machine's structure.

## Collider band extension

`BEAMLINE_TYPES.collider.spec.energyGeV` changes from `[45, 120]` to `[45, 500]`. 45 GeV/beam is the Z pole; 500 GeV/beam is 1 TeV centre-of-mass, CLIC stage 2. The existing comment explaining the 120 ceiling as a cost decision is replaced with the new reasoning.

This widens the band to 1.05 decades — the widest in the roster, and it does soften the "band-gated, not floored" identity more than any other type. Accepted deliberately: the collider is the monument type, and its progression from Z pole to TeV is the intended late-game arc.

`fomRef` for `integratedLuminosity` (currently `1e32`) must be re-measured against the wider band. Per the convention stated in the `beamline-types.js` header, this is a measurement, not an invention — see Calibration.

## Physics integration

**No new `physicsType` values.** Every new component maps onto a member of `KNOWN_PHYSICS_TYPES` (`beam_physics/gameplay.py:62`):

| component | physicsType |
|---|---|
| `cbandStructure`, `xbandStructure`, `twoBeamModule`, `plasmaAfterburner` | `rfCavity` |
| `srf650Cryomodule`, `srf805Cryomodule`, `cwCryomodule`, `nbSnCryomodule`, `srfLinacSector` | `cryomodule` |
| `fastKicker` | `dipole` |
| `recirculationArc` | `chicane` |
| `finalFocusDoublet` | `quadrupole` |

`gameplay.py` needs only `COMPONENT_DEFAULTS` entries (the `energyGain` fallback table at lines 21-27). Catalogue `stats` win over defaults, so the defaults are a safety net; they must nonetheless agree with the catalogue to avoid a misleading fallback.

That table already carries three keys for components that have never existed in the JS catalogue — `cbandCavity` (0.8), `xbandCavity` (1.2) and `srf650Cavity` (1.5). They are dead entries anticipating exactly this ladder. Rekey them to the ids in this spec (`cbandStructure`, `xbandStructure`, `srf650Cryomodule`) with the `energyGain` values from the ladder table, so the defaults agree with the catalogue rather than contradicting it. The fourth speculative key, `harmonicLinearizer`, has no counterpart in this spec and is left alone.

`gameplay.py:209` derives `gradientDemanded` as `energyGain * 1000 / length`, so `subL` and `stats.energyGain` together imply a gradient. Each component's `subL` must produce a gradient consistent with its stated MV/m, or the balance readout will contradict the description.

## RF waveguide: bands, not exact frequencies

The current solver (`src/utility/types/rfWaveguide.js`) buckets sinks by exact `params.frequency` and solves each bucket independently: a fixed-frequency source feeds only its exact bucket, `broadband: true` sources form a shared pool topping up unmet demand, and a bucket with zero capacity gets quality 0 plus a soft `rf_frequency_mismatch`.

That model does not survive contact with the new ladder — it would add five new frequencies (650, 805, 5712, 11424, 11994 MHz) with no matching source, leaving the entire high-gradient ladder dependent on the two large broadband units behind `advancedRf`.

**Replace exact-frequency matching with band matching plus a one-frequency-per-network lock.** Two rules:

1. **A source powers anything in its band.** Sources declare which bands they cover; a source can feed any sink whose band it covers, at any frequency in that band. Many structures at the same frequency share one source freely.
2. **A network carries exactly one frequency.** If a network's sinks span more than one distinct frequency, only the dominant frequency (largest total demand; ties broken by ascending frequency) is served. The rest get quality 0 and a new soft `rf_frequency_split` naming both frequencies and telling the player to run a second network.

Together these give the intended behaviour: different linacs on the same frequency share a source; two frequencies in the same band need two networks, which may use the *same type* of source but not the same source instance.

This **simplifies** `solve()` rather than complicating it. The per-bucket loop and the broadband top-up pool both disappear, replaced by one frequency, one capacity pool. Duty-factor weighting, peak-power conversion and the `rf_overload` path are unchanged. `solve()` already receives a single `network` with its own `sources` and `sinks`, so per-network resolution needs no new plumbing.

### Band table

`rfBand` already exists as a field on components with values `vhf`, `lband`, `sband`, and is currently read by nothing. It becomes the matching key. A new `RF_BANDS` table — colocated with the solver in `src/utility/types/rfWaveguide.js` and exported for UI use — defines:

| band | MHz | tier | components |
|---|---|---|---|
| `vhf` | 50–500 | beginner | `buncher` 200, `pillboxCavity` 200, `halfWaveResonator` 161, `spokeCavity` 325, `rfq` 400 |
| `uhf` | 500–1000 | proton SRF | **`srf650Cryomodule`** 650, **`srf805Cryomodule`** 805 |
| `lband` | 1000–2000 | SRF workhorse | `ellipticalSrfCavity` 1300, `cryomodule` 1300, **`cwCryomodule`**, **`nbSnCryomodule`**, **`srfLinacSector`** 1300 |
| `sband` | 2000–4000 | mid NC | `rfCavity` 2856, `sbandStructure` 2856, `industrialLinac` 2856, `ecrIonSource` 2450 |
| `cband` | 4000–8000 | high-gradient NC | **`cbandStructure`** 5712 |
| `xband` | 8000–16000 | expert NC | **`xbandStructure`** 11424, **`twoBeamModule`** 11994 |

`uhf`, `cband` and `xband` are new; the three existing values keep their meaning.

### Consequence: early-game frequency sprawl

One-frequency-per-network has a sharp edge on the existing catalogue. A tier-2 proton line built from `buncher` (200), `halfWaveResonator` (161), `spokeCavity` (325) and `rfq` (400) has **four distinct frequencies inside one band**, so under the new rule it needs four separate RF networks before it will run. That is a punishing amount of pipe-laying at the exact tier where the player is meeting the utility system for the first time.

The fix is to consolidate the low-band frequencies onto the real PIP-II values, which happen to be exactly the consolidation wanted:

| component | current MHz | new MHz |
|---|---|---|
| `buncher` | 200 | 162.5 |
| `pillboxCavity` | 200 | 162.5 |
| `halfWaveResonator` | 161 | 162.5 |
| `rfq` | 400 | 162.5 |
| `spokeCavity` | 325 | 325 (unchanged) |

PIP-II runs its RFQ, buncher and half-wave resonators all at 162.5 MHz, its spoke resonators at 325, and its elliptical cavities at 650 — so a proton line ends up needing three networks (162.5 / 325 / 650), which is both manageable and a faithful reproduction of how the real machine is sectioned. A tier-1 test stand needs exactly one.

This retunes existing components, so it changes existing behaviour and is called out here for review rather than buried as an implementation detail.

### Source band coverage

Each `rfPower` component gains an `rfBands` array in `infrastructure.raw.js`, replacing `rfFrequency` as the matching key. `params.broadband` is dropped — a genuinely wideband source simply lists every band. Assignments are physically grounded, and **no new source components are needed**:

| source | bands | capacity | rationale |
|---|---|---|---|
| `solidStateAmp` | vhf, uhf | 35 | SSAs are the standard 350–700 MHz choice |
| `twt` | all six | 20 | genuinely wideband, tiny — the unblocker, never the answer |
| `magnetron` | sband | — | 2.45 GHz industrial magnetron |
| `pulsedKlystron` | sband, cband | 50 | |
| `cwKlystron` | uhf, lband | 50 | |
| `iot` | uhf, lband | 80 | IOTs are 470–700 MHz in broadcast, plus L-band |
| `multibeamKlystron` | sband, cband | 200 | |
| `highPowerSSA` | vhf, uhf, lband | 300 | |
| `gyrotron` | cband, xband | 1000 | gyrotrons are inherently high-frequency devices |

This resolves the dependency problem outright: the proton SRF band (`uhf`) is served by `cwKlystron`, `iot`, `solidStateAmp` and `highPowerSSA`; `cband` by `pulsedKlystron` and `multibeamKlystron`; and only `xband` — genuinely the expert tier — needs `gyrotron` behind `advancedRf`. The earlier plan to add band-matched C-band and X-band klystrons is dropped as unnecessary.

`plasmaAfterburner` is not RF: it declares `powerCable`, `coolingWater` and `dataFiber`, no `rfWaveguide`, and its drive-laser power lands on `powerCable`.

## Per-component data requirements

Each new component needs, following the `cryomodule` entry (`beamline-components.raw.js:1436`) as template:

- **`src/data/beamline-components.raw.js`** — full entry: `id`, `physicsType`, `name`, `desc`, `category: 'rf'|'optics'`, `subsection` (one of the existing `normalConducting` / `superconducting` / `focusing` / `manipulation` — no new subsections; `test-registry-integrity.js:377` asserts every component lands in a subsection that exists), `cost`, `stats`, `energyCost`, `apertureRadius`, `subL`/`subW`/`subH`/`gridW`/`gridH`, `geometryType`, `interiorVolume`, `requires`, `spriteKey`, `spriteColor`, `accentColor`, `params`, `placement`, `role`, `ports`, `beamlineTypes`, `requiredConnections`, and for RF `rfFrequency` / `rfBand` / `rfPowerRequired`.
- **`src/data/utility-ports-v2.js`** — a port entry declaring its own `demand` / `heatLoad` / `srfHeatW` / `outgassing` params. Per that file's header, ports declare their own numbers; the per-utility `SINK_DEFAULTS` are a safety net, not a place to rely on.
- **`src/data/research.js`** — added to exactly one node's `unlocks`.

`recirculationArc` follows `injectionSeptum`'s multi-port junction pattern (`role: 'junction'` with a `routing` array) rather than inventing new routing: a lateral bypass that leaves and rejoins the axis. It must not require new routing primitives.

Two further files change once, not per component:

- **`src/utility/types/rfWaveguide.js`** — the `RF_BANDS` table, band-eligibility matching, the one-frequency-per-network lock and the `rf_frequency_split` diagnostic. The per-bucket loop and broadband pool are removed.
- **`src/data/infrastructure.raw.js`** — `rfBands` arrays on the nine `rfPower` sources, replacing `rfFrequency` as the matching key and dropping `params.broadband` in `utility-ports-v2.js`.

## Graphics

Each component needs two independent pieces of art.

### 3D — `ROLE_BUILDERS.<id>` in `src/renderer3d/component-builder.js`

A builder returns role buckets (`accent`, `iron`, `copper`, `pipe`, `stand`, `detail`) of already-transformed `BufferGeometry`, merged and cached once per type. `_buildEllipticalSrfCavityRoles` (line ~2020) is the reference for a cryomodule-class component; `_buildSpokeCavityRoles` for a smaller SRF unit. Conventions to follow: `BEAM_HEIGHT` for axis height, beam-pipe stubs plus CF flanges at tile edges, support pedestals in the `stand` role, `applyTiledCylinderUVs` / `applyTiledBoxUVs` on every geometry, and `detail`-role meshes for LOD-droppable trim.

### 2D — schematic drawer in `src/ui/overlays.js`

A `<id>(p, px, dot, W, H, cy, C, params)` entry in the schematic drawer table, drawing pixel art at ~70×30 into an offscreen canvas which is then scaled up unsmoothed. `spokeCavity` (line 2784) and `quadrupole` (line 708) are the reference implementations. Use the shared palette `C` (which already carries `scMagnet`/`scMagDk` for superconducting, `coil`/`coilDk` for warm magnets, `copper`-adjacent `hot` tones for NC RF) and `_drawBeamPipe` with `skipFrom`/`skipTo` where the structure interrupts the pipe.

### Visual identities

Each must be recognisable at 70×30 *and* distinguishable from its neighbours on the ladder, since several are the same family at different scales.

- **`cbandStructure`** — copper disc-loaded waveguide, cell pitch visibly finer than `sbandStructure`, single waveguide feed, water manifold along the top.
- **`xbandStructure`** — finest cell pitch on the ladder, small bore, waveguide manifolds above *and* below, water headers both sides. Reads as "dense copper comb".
- **`srf650Cryomodule`** — squatter and fatter than `cryomodule`: 5 large elliptical cells (650 MHz is physically bigger than 1.3 GHz), single cryo port, warm-to-cold transitions at both ends.
- **`srf805Cryomodule`** — same family, 6 visibly smaller cells, twin cryo ports. Must read as "the next one up" from 650 at a glance.
- **`cwCryomodule`** — `cryomodule` silhouette with a heavier cryogenic header along the top and doubled coupler boxes (CW means continuous heat load).
- **`nbSnCryomodule`** — distinguished by colour: a warmer accent (4.5 K, not 2 K) and a smaller, simpler cryo plant connection than the 2 K units.
- **`srfLinacSector`** — long vacuum-jacketed cryostat, multiple segments with interconnect bellows, cryo distribution line along the full length, a row of coupler boxes.
- **`twoBeamModule`** — two parallel beam lines at different heights (drive beam above, main beam below) linked by PETS transfer structures. The doubled axis is the identity.
- **`plasmaAfterburner`** — short sapphire capillary cell, large laser enclosure box beside the axis, turning-mirror housing, injection chicane. The laser hall is the silhouette; no waveguide anywhere.
- **`fastKicker`** — small ferrite window-frame magnet dwarfed by its pulse-forming-network cabinet, with thick coaxial pulse cables. The cables are the identity.
- **`recirculationArc`** — beam pipe splits, arcs laterally, rejoins; a row of small dipoles along the arc.
- **`finalFocusDoublet`** — two large SC quads back-to-back at different apertures in a shared cryostat, conical taper toward the IP.

## Gating and allowlist fixes

Independent of the new components, and required for them to be reachable when their type unlocks:

- `spallation.requires` gains `protonAcceleration` — it currently unlocks via `cwLinacDesign` + `targetPhysics`, whose closure never reaches `protonAcceleration`, so `ionSource` and `rfq` are both locked and the only available source is `cockcroftWalton` at 0.75 MeV.
- `therapy.requires` gains `protonAcceleration` — same cause; buildable today via `cyclotron230`, so lower severity, but the linac front-end path is closed.
- `collider.requires` gains `bunchCompression` and `srfTechnology` — currently a collider unlocks with no `chicane` and no `cryomodule`.
- `isotopeIrradiation.requires` gains `targetPhysics` — `target` is its productive endpoint and is otherwise locked at unlock, silently falling back to `beamStop`.
- `ebeamProcessing.excludes` gains `velocitySelector` and `emittanceFilter` — a 10 MeV sterilisation line has no more use for a Wien filter than for the `sextupole` already excluded there.

Each `requires` change must keep `beamlineTypesFor()` ordering stable and must not make a type unreachable; the research nodes added are all already in the tree.

## Calibration

Costs in this spec are provisional, following the convention already stated for `fomRef` in the `beamline-types.js` header: **build the reference recipe in `scripts/balance-sim.mjs`, measure, and replace the number.** Specifically:

- `collider.fomRef` must be re-measured against the `[45, 500]` band. The current `1e32` was chosen for a 45–120 machine and will not hold.
- Per-rung costs should be checked against the resulting total capital per type. Expect roughly $1.2–2.5B per arm for a base collider and ~$8.4B per arm for the TeV configuration, against a `colliderTech` research cost of $41M. That is a deliberate jump for the monument type, but it is the number most likely to need adjusting after a play pass.
- `src/data/stock-designs.measured.json` is regenerated by the existing measurement script; any stock design touching changed components must be re-measured rather than hand-edited.

## Acceptance criteria

1. `node test/test-registry-integrity.js` passes with `KNOWN_OPEN_GATING` still empty — every new component is advertised by exactly one research node and gated by it.
2. Every new component's `physicsType` is in `KNOWN_PHYSICS_TYPES`; `beam_physics/gameplay.py` raises on none of them.
3. Every new component lands in an existing subsection (`test-registry-integrity.js:377`).
4. A new `test/test-beamline-type-coverage.js`, following the plain-assert style of `test-registry-integrity.js`, asserts for each of the nine types that the band top is reachable in **≤ 35 RF placements** using only components visible in that type's palette at full research, and **≤ 40** using only components unlocked by the research closure of that type's own `requires`. This is the regression guard for the whole spec: it is the check that would have caught the original 220–595 figure.
5. No type's palette loses a source, an RF structure, or a `requiredEndpoint` (the existing audit invariants).
6. Every new component has both a `ROLE_BUILDERS` entry and a schematic drawer. The fallback-geometry check at `component-builder.js:2227` is an info-level coverage report that fails nothing, so this is verified by confirming that report names none of the new components.
7. `node scripts/build-wiki.mjs` regenerates cleanly if wiki articles reference the new components.
8. Existing tests (`test-beamline-types.js`, `test-beamline-picker.js`, `test-compound-machines.js`, `test-beamline-system.js`) pass unchanged.
9. RF band matching, covered by tests on `rfWaveguide.solve()`:
   - every RF sink in the catalogue has an `rfBand` that appears in `RF_BANDS`, and its `rfFrequency` falls inside that band's range;
   - every `rfPower` source declares a non-empty `rfBands`, and every band in `RF_BANDS` is covered by at least one source;
   - N structures at one frequency sharing one in-band source all receive quality > 0;
   - a source whose bands do not cover the sink's band yields `rf_frequency_mismatch`;
   - a network with sinks at two frequencies serves the higher-demand one and raises `rf_frequency_split` for the other, deterministically under tie (ascending frequency);
   - splitting that network in two, each with its own source of the same type, clears the diagnostic and returns both to quality > 0.

## Out of scope

- New `rfPower` source components. Band matching makes the existing nine sufficient; adding band-matched klystrons is no longer needed.
- Automatic network splitting in the UI. A player who mixes two frequencies on one network gets the `rf_frequency_split` diagnostic and splits it by hand; the game does not re-route for them.
- Real energy-recovery physics for `euvFel` — `recirculationArc` is modelled as a `chicane` and does not actually recover beam power.
- A luminosity model driven by `finalFocusDoublet`; the collider's `integratedLuminosity` FoM continues to read `collisionPoint`'s flat `collisionRate`.
- Any change to the economy's income side to match the collider's new capital scale.
