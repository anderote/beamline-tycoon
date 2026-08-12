# Beamline Types — Design Spec

Date: 2026-08-11
Consolidates three parallel design studies (roster, component sets, figures of
merit) into one design.

Consumes: `2026-08-11-utility-driven-beam-physics-design.md`, which reserved
this work explicitly.

Out of scope: customer contracts (per-customer spec sheets, pay-per-beam-hour).
That is the natural follow-on and this design is shaped to accept it.

## Problem

Every beamline in the game is the same machine. There is no notion of what a
beamline is FOR, the build palette is identical regardless, and income is

```
beam = quality × (beamIncomeBase + beamIncomePerNode × nodeCount)
```

Energy and current appear nowhere in that expression, and revenue grows
monotonically with component count. So "high tiers strictly dominate" is not a
balance risk to be designed around — it is currently hard-coded into the income
function.

Meanwhile `BeamlineRegistry` already stamps a `machineType` on every beamline
that nothing ever sets to anything but `'linac'`; `beam_physics/machines.py`
carries a per-type `success_metric` that nothing reads; and `hud.js:1697`
documents a deleted palette gate with the note *"re-introduce tier gating only
alongside a real machine-type progression path."* This is that path.

## Design

The player clicks **New Beamline**, picks a type from a grid (locked entries
greyed, naming the research node needed), and from then on that beamline's
palette is filtered to that type's components. The type is fixed at creation;
changing it means demolishing, as with an RCT coaster.

Two mechanisms carry the whole design:

1. **Each type declares one physics output it is paid on.** A spallation source
   and an XFEL can be built from overlapping hardware and still play nothing
   alike, because one is scored on `E × I` and the other on emittance-limited
   brilliance — and those are optimised by opposite decisions about the same
   components.
2. **Each figure of merit is band-gated.** A Test Stand at 8 GeV is not a very
   good Test Stand; it is not a Test Stand at all. Bands, not floors, are what
   keep a tier-1 type economically live in the late game.

Because the utility-driven physics landed first, every FoM traces back to a
provisioning decision: `E_acc = √(P·(R/Q)·Q₀)/L` means beam energy is bought
with RF watts and cryogenic cold, and `beam_gas` means emittance is bought with
pump speed. So *"which output am I paid on"* becomes *"which utility do I
over-provision"* — and the nine types want different answers.

### 1. The roster

Arranged as a **money / data / prestige triangle**, not a power ladder. Every
tier holds at least one money type and one data type, so climbing the tree buys
research throughput while staying low buys the cash that pays for it.

| id | Name | T | Species | Energy band | Paid on | Gate |
|---|---|---|---|---|---|---|
| `testStand` | Test Stand | 1 | e⁻ | 5–50 MeV | data (tiny) | — |
| `ebeamProcessing` | E-beam Processing Line | 1 | e⁻ | 3–12 MeV | **money** | — |
| `isotopeIrradiation` | Isotope & Irradiation | 2 | p⁺/ion | 15–70 MeV | money + data | `protonAcceleration` |
| `therapy` | Therapy Line | 2 | p⁺ | 70–250 MeV | money (uptime) | `isochronousCyclotron` + `machineProtection` |
| `spallation` | Spallation Neutron Source | 3 | p⁺ | 0.8–3 GeV | data + money | `cwLinacDesign` + `targetPhysics` |
| `lightSource` | Synchrotron Light Source | 3 | e⁻ | 2.5–6 GeV | data + prestige | `storageRingTech` + `synchrotronLight` |
| `xfel` | XFEL (hard X-ray) | 4 | e⁻ | 6–17.5 GeV | **data** + prestige | `felTech` |
| `euvFel` | EUV FEL Drive Line | 4 | e⁻ | 0.8–1.2 GeV | **money (max)** | `felTech` + `energyRecovery` |
| `collider` | Linear Collider | 5 | e⁺e⁻ | 45–120 GeV/beam | prestige | `colliderTech` |

**No new research nodes.** Every gate reuses an existing node, several of which
already describe the machine in their `desc` text — `cwLinacDesign` says
"MW-class beam power"; `energyRecovery` is the ERL node an EUV drive needs.

Two roster decisions worth recording:

**XFEL and EUV FEL are separate types.** They sit at opposite ends of both the
energy and the current axis: 6–17.5 GeV at µA versus 0.8–1.2 GeV at 10 mA CW.
A machine built for one is actively wrong for the other, which makes this the
clearest demonstration of band-not-floor in the roster — building an EUV line
to 8 GeV is a $200M mistake, not an upgrade. It also lets tier 4 be a genuine
choice between money and science, and makes the top tier the *most* buildable
rather than the least (an 800 MeV CW SRF linac is ~5 cryomodules).

**E-beam Processing exists because tier 1 has no money type.** The Irradiation
Line sits behind $7.6M of research on a $2.5M start, so the opening is a grind
against `baseGrant` with nothing to build toward. Industrial sterilisation
(IBA Rhodotron class, 10 MeV/100 kW) is ungated because it is electrons, and is
paid on **beam power rather than beam quality** — the one type where a
beginner's scruffy beam still earns, while teaching E × I = P.

### 2. Data model

New `src/data/beamline-types.js` exporting `BEAMLINE_TYPES`, keyed by id:

```
{ id, name, tier, machineType, particle,
  spec:     { energyGeV: [lo, hi], currentMA: [lo, hi], ... },
  fom:      'beamPower' | 'fluence' | ... ,
  fomRef:   <value at which fomScore = 1>,
  bandWidth:<Gaussian-in-decades falloff w>,
  requires: <research node id | [ids]>,
  excludes: [componentId, ...],
  requiredEndpoint: [componentId, ...],
  blurb, icon, accentColor }
```

Components gain an optional `beamlineTypes` allowlist. **Omitted means trunk.**
The two directions carry different meanings and both are needed: an allowlist
on a component says "this is special-purpose hardware"; a denylist on a type
says "this is general hardware that is wrong here", and keeping the latter on
the type is what makes each type's identity readable in one place.

The palette filter goes at `src/ui/hud.js:1697`, the exact site whose comment
anticipates it. `MACHINE_TIER` in `src/data/machines.js` is deleted — this
design replaces it, and `test/test-registry-integrity.js` currently allowlists
seven dead ids that only exist to keep it alive.

### 3. Component sets

The trunk rule: **species-agnostic, energy-agnostic, and exists to transport,
steer, observe or safely terminate — not to make the type's product.** That
deliberately leaves sources and productive endpoints out of the trunk, which is
what gives each type a distinct identity at both ends.

Trunk (21): drift, bellows, quadrupole, corrector, dipole, solenoid, sextupole,
aperture, collimator, buncher, pillboxCavity, bpm, ict, screen, wireScanner,
beamLossMonitor, energySpectrometer, beamStop, faradayCup, plus
velocitySelector and emittanceFilter as trunk-with-exclusions. All of Infra
mode is trunk by construction.

The strongest differentiator is **the RF split on β**. The trunk holds exactly
one accelerating structure; above it, RFQ/DTL/low-β SRF go to protons and
S/C/X-band plus elliptical SRF go to electrons. The in-fiction reason is real
physics: a 1.3 GHz elliptical cavity's cells are cut for β=1 and would
*decelerate* a 70 MeV proton.

Other deliberate exclusions: undulators are barred from the collider (photons
there are a loss mechanism, not a product) and from all proton types (γ≈1–4
protons do not radiate); `chicane` is denied to the light source and
`harmonicCavity` to the XFEL, since one compresses bunches and the other
lengthens them; `target` is excluded everywhere, replaced by four specialised
endpoints.

Rejected: `protonQuad` / `protonDipole` as separate components. Rigidity is a
property of the beam, not of the magnet.

### 4. Figures of merit

Built on the unit identity `1 GeV × 1 mA = 1 MW`, so several need no constants.
Each type declares a `dutyFactor` applied only inside its FoM, since the
simulator has no pulse structure and every beam is effectively CW.

| Type | FoM | Status |
|---|---|---|
| `testStand` | beam power, kW | live |
| `ebeamProcessing` | beam power, kW, band-gated hard on energy | live |
| `isotopeIrradiation` | fluence `I·U/(2π σx σy)` with a **spot-size band** | live |
| `therapy` | dose availability from `continuousBeamTicks` | live |
| `spallation` | beam power MW, gated hard on `totalLossFraction` | live |
| `lightSource` | photon flux × ports | **needs new physics** |
| `xfel` | brilliance × `min(1, saturation)²` | needs undulator + machineType |
| `euvFel` | average photon power at 13.5 nm | needs undulator + machineType |
| `collider` | integrated luminosity | needs `positronSource` + second beam |

Three of these are worth calling out as design, not arithmetic:

- **Irradiation uses a spot-size band**, because real irradiation wants a
  defocused *uniform* beam. This is physically correct and it closes the
  otherwise-inevitable "add quadrupoles until σ→0" exploit.
- **Spallation gates hard on loss fraction** — a 1 MW beam losing 1% activates
  the tunnel. It is the one type where vacuum spending converts to revenue.
- **Therapy is dimensionless and capped near 1.15**, built on
  `continuousBeamTicks` (tracked today, read by nothing). It cannot be
  min-maxed, only made reliable.

`finalBeamSizeX/Y` is fully simulated, exported to JS, and currently read by
nothing. Two FoMs use it, which is what makes optics pay for those types.

**Band gate.** `bandGate(x, lo, hi, w)` returns 1 inside the band and
`exp(-(d/w)²)` outside, where `d` is distance in **decades**. Log-space so one
`w` means the same thing for a 5–50 MeV band and a 0.8–3 GeV band; Gaussian
because its derivative is zero at `d=0`, so it meets the flat interior smoothly
instead of putting a kink exactly where players operate. One-sided gates fall
out of null bounds. Therapy uses `w=0.12` (clinical); Test Stand `w=0.45`.

### 5. Economy integration

The FoM score **multiplies**, it does not replace:

```
beam = quality × fomScore × typeMult × (beamIncomeBase + beamIncomePerNode × nodeCount)
fomScore = clamp(sqrt(fom / fomRef), 0, 2.5),  default 1.0 when absent
```

An earlier draft had `fomScore` replacing the bare `beamQuality` term. That is
wrong for two reasons, both load-bearing: it deletes the only optics term from
types whose FoM contains no emittance (a scrambled beam inside the aperture
would earn full price), and it breaks the pinned regression at
`test-convergence-regressions.js:290` asserting quality 0 → income 0. Keeping
`quality` a strict multiplier satisfies that for free.

At `fomScore = 1` the expression is byte-identical to today's, so the
`beamIncomePerNode = 240` capital-payback derivation survives untouched and the
whole effect reads as "how far from a reference machine of this type are you".

`fomRef` must be a **measured reference machine, not a starter machine** —
otherwise the 2.5 clamp binds after one energy upgrade. Provisional values are
specified per type, each with an analytic basis, plus the calibration rule:
build the reference recipe in `balance-sim.mjs`, measure, replace.

Two things this deliberately does not fix: `dataFees` stays type-blind (funding
and research are separate channels), and the linear-node-count "N copies earn
N×" pathology survives, since `fomScore` is per-beamline.

### 6. Physics wiring

`beam_physics/machines.py` grows from 4 configs to 9 — one per game type, with
**explicit per-type module lists** replacing the nested `_TIER1→_TIER4`
construction. That nesting is why `collider` silently inherits `FELGainModule`,
which is why `fel_gain.py` carries `"collider"` in its machine-type set.

Module gating moves to **capability sets on the config** (`{"fel"}`,
`{"beam_beam"}`, `{"sr_light"}`) instead of hardcoded type-name literals inside
module files — that literal-matching is exactly the drift that stranded
`dcPhotoGun`. `success_metric` finally becomes live data.

Critically: **`lightSource` must not run FEL gain.** If it maps to a machine
type inside `MACHINE_TYPES_WITH_FEL`, a storage ring will report saturation it
physically cannot reach.

### 7. What is buildable, honestly

Five of nine work on the current engine. The blockers:

- **`lightSource`** needs both a `synchrotron_light` module (closed-form
  bending-magnet flux from `ρ = length/θ`, `E`, `I` — no free parameters) and
  ring topology. The only type needing both. Recommendation: ship it as a
  ploppable ring with a player-built linear injector and photon front ends.
- **`collider`** works on the linear flattener today — `collisionPoint` already
  has `entryA`/`entryB` — but needs `positronSource` and a `'positron'` species
  in `constants.py`.
- **`xfel`** is blocked on affordability, not physics: 17.5 GeV of `cryomodule`
  is $1.05B against a $592M research tree. Restoring C/X-band fixes it.
- Three types want **parallel branches**, and `pickDominantEntry` currently
  discards every secondary branch silently.

`undulator`, `chicane`, `collimator`, `solenoid` and `combinedFunctionMagnet`
already exist as of this spec's date, so the FEL and bunch-compression paths
are open.

## Testing

- Every type resolves to a valid `machineType` present in `MACHINE_TYPES`, and
  every gate resolves to a real research node.
- Every type's `requiredEndpoint` and `excludes` reference real component ids —
  the same self-cleaning discipline `test-registry-integrity.js` already
  enforces.
- `bandGate` is 1 inside the band, continuous and C¹ at both edges, monotone
  outside, never negative.
- Each live FoM is monotone in its driving quantity and correctly penalises
  out-of-band operation: a 2 GeV therapy line scores ~0.
- **The shipped `smallBeamlineFacility` starter must score
  `fomScore ∈ [0.8, 1.2]`**, or run B of `balance-sim.mjs` goes net-negative and
  the game's opening breaks.
- The three invariants in `test/test-economy-balance.js` still hold.
- New risk this design introduces: two FoMs are drift-length-sensitive, so the
  existing node-spacing invariance test needs a per-type companion.

## Shipping order

**Wave 1** — data model, palette filter, New Beamline picker, `machines.py`
expansion, and the four live-physics types (`testStand`, `ebeamProcessing`,
`isotopeIrradiation`, `therapy`). Proves the mechanic end to end on physics that
already works.

**Wave 2** — `spallation`, band gate and FoM scoring in the economy, balance
recalibration.

**Wave 3** — `xfel` and `euvFel`: undulator wiring, machine-type capability
sets, C/X-band restoration for affordability.

**Wave 4** — `collider` (`positronSource`, positron species).

**Wave 5** — `lightSource`: `synchrotron_light` module plus the ring
abstraction. Deliberately last; it is the only item needing new physics *and*
new topology.
