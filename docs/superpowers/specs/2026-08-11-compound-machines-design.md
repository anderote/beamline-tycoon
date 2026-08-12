# Compound Machines — design

*2026-08-11*

## 1. What this is

A **compound machine** is a single placeable that is source + acceleration +
extraction in one box. You plop it, it has a beam exit port, you draw pipe from
it, and everything downstream is an ordinary player-designed beamline.

It is the RCT2 **flat ride** to the beamline's coaster: something you buy
rather than design, that occupies a footprint, earns modestly, and never
competes with a well-designed line. Crucially it is *not* a replacement for a
beamline — it is a **front end for one**. The tier-4 LWFA hands you a GeV and
then leaves you the entire rest of the machine to build.

Five machines ship, plus one supporting infrastructure placeable.

## 2. It needed no engine change

This is the whole reason the feature is cheap. `beam_physics/gameplay.py`
`extract_source_params()` already routes, for any element with
`physicsType: 'source'`:

| raw field | becomes |
|---|---|
| `extractionEnergy` (GeV) | `source_params["energy"]` — the initial beam energy |
| `stats.emittance` (mm·mrad) | `source_params["eps_norm_x/y"]`, ×1e-6 → m·rad |
| `params.particleType === 'proton'` | `source_params["mass"] = PROTON_MASS` |
| `stats.beamCurrent` (mA) | `source_params["current"]` |

So a compound machine is pure data: `isSource: true`, `physicsType: 'source'`,
`placement: 'module'`, `role: 'junction'`, `routing: []`, one `exit` port, and
an `extractionEnergy`. Verified end to end against the Python engine:

```
Van de Graaff     extractionEnergy 0.00300 ->    3.0 MeV
Cockcroft-Walton  extractionEnergy 0.00075 ->    0.75 MeV  (proton mass)
Cyclotron 30      extractionEnergy 0.03000 ->   30.0 MeV   (proton mass)
Cyclotron 70      extractionEnergy 0.07000 ->   70.0 MeV   (proton mass)
LWFA Station      extractionEnergy 1.00000 -> 1000.0 MeV
```

### The one fragile link

`Game.js` and `BeamlineDesigner.js` both resolve extraction energy as:

```js
if (computed?.extractionEnergy !== undefined) use computed;
else if (comp.extractionEnergy !== undefined) use the static field;
```

`computed` is `computeStats(id, params)` and exists only for ids that have a
`PARAM_DEFS` entry in `src/beamline/component-physics.js`. **None of the five
compound machines has one**, which is exactly why their static
`extractionEnergy` reaches the engine. Adding tunable sliders to one of them
later without also deriving `extractionEnergy` from those tunables would drop
the machine to the engine's 0.01 GeV default — a 1 GeV LWFA silently becoming a
10 MeV one, with no error anywhere. `test-compound-machines.js` pins this.

## 3. The `beamQuality` constraint — and a correction to it

### 3.1 What was believed

`beamQuality = initial_emittance / final_emittance`. It measures emittance
**preservation**, not emittance. Therefore (the reasoning went) you cannot
express "the LWFA makes a poor beam" through `stats.emittance` and expect a
quality penalty: it will score 1.000 at any value.

### 3.2 What is actually true

Half right, and the other half is inverted. Measured by sweeping source
emittance through the real engine on a source → drift → endpoint line:

**At high energy the claim holds exactly.** `lwfaStation` at 1 GeV:

| `stats.emittance` | `beamQuality` | `finalNormEmittanceX` |
|---|---|---|
| (omitted) | 1.000 | 1.0e-6 |
| 1 | 1.000 | 1.0e-6 |
| 5 | 1.000 | 5.0e-6 |
| 10 | 1.000 | 1.0e-5 |
| 20 | 1.000 | 2.0e-5 |

The beam is stiff, nothing grows, quality is pinned at unity, and the declared
emittance passes straight through to `finalNormEmittanceX`. So for the LWFA the
original reasoning is correct: give it a large emittance because that is
physically true, and it costs the player nothing until a figure of merit reads
*absolute* emittance. `xfel`'s `felBrilliance` does (see
`2026-08-11-beamline-types-design.md` §4). Nothing here fudges quality to force
a penalty.

**At low energy it is not merely absent — it runs backwards.** `cyclotron30`
at 30 MeV, 0.35 mA of protons, same line:

| `stats.emittance` | `beamQuality` | `finalNormEmittanceX` |
|---|---|---|
| 0.5 | 0.001 | 9.6e-4 |
| 2 | 0.002 | 9.4e-4 |
| 6 | 0.006 | 9.6e-4 |
| 20 | 0.021 | 9.4e-4 |

The final emittance is set almost entirely by space-charge blow-up and is
essentially *independent of the source*. Since quality is the ratio
initial/final, **declaring a bigger source emittance raises `beamQuality`** —
by 20× across that sweep. Emittance is not a free flavour knob on any machine
below ~100 MeV; it is a revenue lever pointing the wrong way.

**Consequence for tuning.** The low-energy machines are deliberately given
modest, physically defensible emittances (5–12 mm·mrad) and nobody should
"improve realism" by raising them. The LWFA's 10 mm·mrad is safe precisely
because it sits at 1 GeV.

### 3.3 A second measured surprise

The engine annihilates *any* space-charge-dominated beam sent down an
unfocused drift, and it does so far more brutally to the existing sources than
to the new ones. Same three-element line, source → 4 m drift → beam stop,
current out of the endpoint:

| source | out of 100% |
|---|---|
| `source` (electron gun, 50 keV) | 2e-69 |
| `ionSource` (duoplasmatron, 40 keV) | 1e-141 |
| `cockcroftWalton` (750 keV) | 1e-100 |
| `cyclotron30` (30 MeV) | 1e-35 |
| `vanDeGraaff` (3 MeV) | 1.3% |
| `lwfaStation` (1 GeV) | 100% |

This is pre-existing engine behaviour, not something compound machines
introduce — every machine here transmits *better* than the gun it replaces,
because it starts higher. It is recorded because it means low-energy front ends
are effectively unusable without a great deal of focusing, which is a real
balance question for the proton tree and is out of scope for this change.

## 4. The roster

Sizes are in sub-units (1 sub-unit = 0.5 m). Power is the `powerCable` sink
demand in kW; cooling is the `coolingWater` sink heat load.

### 4.1 `vanDeGraaff` — Van de Graaff Generator (tier 1, ungated)

| | |
|---|---|
| species / energy | e⁻, **3 MeV** |
| current / emittance | 2 mA / 5 mm·mrad → 6 kW of beam |
| footprint | 4 × 6 × 6 (2 m × 3 m, 3 m tall) |
| cost / draw | $350 k / 30 kW power, **no cooling** |
| palette | `testStand`, `ebeamProcessing` |

**Anchor.** HVE and NEC single-ended electrostatic accelerators, 0.5–5 MV
terminal in an SF₆ pressure tank, milliamp-class currents; the same column
family used for cable crosslinking and for university ion-beam analysis.

**Role.** The cheapest working accelerator in the game and the only one that
asks for a single utility. 3 MeV sits inside `ebeamProcessing`'s 3–12 MeV
regulatory window (the ceiling is the one above which electrons start
activating the sterilised product) and at the bottom edge of `testStand`'s
5–50 MeV band. It is deliberately an order of magnitude under the Rhodotron
TT300 that `ebeamProcessing`'s `fomRef` of 100 kW is calibrated against: this
is a trickle of low-tech revenue, not a competitive processing line.

**The no-cooling decision** is the identity. Plop it, draw pipe to a beam stop,
hang one `powerPanel` (40 kW capacity, so 30 kW fits with room) and one
roughing pump, and there is income on tick 1. Every other accelerator in the
catalogue needs at least two networks.

### 4.2 `cockcroftWalton` — Cockcroft-Walton Set (tier 1, ungated)

| | |
|---|---|
| species / energy | p⁺, **750 keV** |
| current / emittance | 30 mA / 12 mm·mrad |
| footprint | 6 × 6 × 8 (3 m × 3 m, 4 m tall) |
| cost / draw | $900 k / 45 kW power, 25 kW cooling |
| palette | `isotopeIrradiation`, `therapy`, `spallation` |

**Anchor.** The Fermilab 750 kV preinjector (1971–2012), the BNL 750 kV set,
and CERN Linac2's — a Greinacher/Cockcroft-Walton rectifier-capacitor cascade
with a duoplasmatron sitting in the terminal, delivering ~50 mA of H⁻.

**Role — and the one place this design departs from the brief.** The brief put
this at tier 1 as "low-tech revenue" alongside the Van de Graaff. It cannot be
that: the lowest proton band in the type roster is `isotopeIrradiation`'s
15 MeV, twenty times its extraction energy, so a 750 keV proton machine can
never be paid on its own. It is a **pure front end**, and the test pins that
distinction so nobody accidentally "fixes" it into a standalone earner.

What it actually competes with is `ionSource` + `rfq`: $400 k + $1.5 M for
3.04 MeV, plus an entire `rfWaveguide` network with a klystron on it to feed
the RFQ. The Cockcroft-Walton is $900 k for 750 keV and needs no RF plant at
all — cheaper capital, lower energy, one fewer utility network. That is a real
trade rather than a strict upgrade.

**It stays ungated** (`unlocked: true`) as the brief asked, and that is
harmless: its allowlist names only the three proton types, and every one of
those is itself gated behind `protonAcceleration` or higher. It becomes visible
at exactly the moment it becomes useful.

### 4.3 `cyclotron30` — Compact Cyclotron, 30 MeV (tier 2, `cyclotronTech`)

| | |
|---|---|
| species / energy | p⁺, **30 MeV** |
| current / emittance | 0.35 mA / 6 mm·mrad → 10.5 kW of beam |
| footprint | 8 × 8 × 6 (4 m × 4 m, 3 m tall) |
| cost / draw | $6 M / 140 kW power, 115 kW cooling |
| palette | `isotopeIrradiation` |

**Anchor.** IBA Cyclone 30 — 30 MeV H⁻, 2 × 350 µA dual extraction, ~4 m
diameter yoke; ACSI TR-30; GE PETtrace at 16.5 MeV as the smaller cousin. The
machine that makes the ¹⁸F in a PET scan.

**Role.** The **only compound machine that is a complete revenue beamline**.
30 MeV × 350 µA lands inside `isotopeIrradiation`'s 15–70 MeV and
0.1–1.0 mA bands simultaneously. It still is not free money: the type demands a
`target` or `beamStop` endpoint and has a *spot-size* band (5–50 mm), so the
player has to draw pipe and defocus onto a uniform field. A small beamline, not
an absent one — which is exactly the flat-ride shape.

`cyclotronTech` is itself the ungated root of the machineTypes tree, so a
determined player can reach the first plop-and-earn machine early. That is
intended.

**Utility identity.** A cyclotron is a water heater that occasionally emits
protons: 10 kW out against 140 kW at the wall. The numbers are placed so that
one `padMountTransformer` (150 kW) is exactly enough and one `lcwSkid` (100 kW)
is exactly not.

### 4.4 `cyclotron70` — Multi-particle Cyclotron, 70 MeV (tier 2, `isochronousCyclotron`)

| | |
|---|---|
| species / energy | p⁺ (also d, α in flavour), **70 MeV** |
| current / emittance | 0.75 mA / 8 mm·mrad → 52 kW of beam |
| footprint | 10 × 10 × 8 (5 m × 5 m, 4 m tall) |
| cost / draw | $22 M / 380 kW power, 310 kW cooling |
| palette | `isotopeIrradiation`, `therapy` |

**Anchor.** ARRONAX (Nantes) — IBA Cyclone 70XP, 70 MeV, 2 × 375 µA, source
configurable for H⁻/D⁻/He²⁺/α. Modelled as one 750 µA beam because the
flattener walks a single path and cannot express dual extraction.

**Why `isochronousCyclotron` is the right gate.** Sector-focused AVF field
shaping — a radially increasing field that holds the revolution frequency
constant as the protons go relativistic — is precisely what a 70 MeV machine
needs and a 30 MeV one does not. The node and the hardware are the same
statement.

**On the `therapy` allowlist.** 70 MeV protons treat ocular melanoma and
essentially nothing else; Clatterbridge (62 MeV) and CATANA (62 MeV) are exactly
this machine doing exactly this job, and 0.070 GeV is the precise bottom of
`therapy`'s band. It is in the palette on that strength. Note that 750 µA is
**15× over** `therapy`'s 1–50 µA window, so plopping one and calling it a clinic
scores badly on purpose. A therapy line is a designed line.

### 4.5 `lwfaStation` — LWFA Station (tier 4, `plasmaAcceleration`)

| | |
|---|---|
| species / energy | e⁻, **1 GeV** |
| current / emittance | 1 µA / 10 mm·mrad |
| footprint | 8 × 12 × 5 (4 m × 6 m) |
| cost / draw | $48 M / 420 kW power, 400 kW cooling, 8 Gbps fibre |
| palette | `testStand`, `lightSource`, `xfel`, `euvFel`, `collider` |

**Anchor.** LBNL BELLA: 1 GeV in a 3.3 cm capillary at 40 TW (Leemans et al.,
2006) and 8 GeV in a 30 cm one in 2019. A GeV station is the *conservative*
reading of the record, not the optimistic one.

**Role.** 1 GeV in a crate against five `cryomodule`s (0.2 GeV each, $12 M
each, plus a 2 K cold box and an RF plant) is the proposition. $48 M is
deliberately more than three cryomodules: you are buying **length and
cryoplant**, not a discount. Its real use is as a front end that hands an
`xfel` or a `collider` a GeV and then makes them live with the phase space.

On its own it lands inside `euvFel`'s 0.8–1.2 GeV band and fails that type's
5–15 mA CW requirement by four orders of magnitude — correct, and a good lesson
for the player about what a duty cycle means.

**The emittance number is a chromatic equivalent, not the plasma-exit value.**
LWFA beams leave the capillary with a genuinely small normalised emittance
(~1 mm·mrad, competitive with a photoinjector). What ruins them is 1–3% energy
spread, milliradian divergence, and shot-to-shot jitter — and the engine's
source model has no energy spread to give. 10 mm·mrad is that chromatic
blow-up through the first capture quadrupole, expressed in the one number the
engine reads. It is ~7× a thermionic gun's computed 1.35 mm·mrad, and per §3.2
it costs nothing until `felBrilliance` reads it.

**The current number is forward-looking on purpose.** 100 pC at ~10 kHz = 1 µA,
which is the kHz-class LWFA the field is actually building toward (kBELLA,
ATHENA, LUX) rather than a 1 Hz demonstrator. Chosen so the beam stays inside
`xfel`'s 0.5–10 µA window: the penalty should land on emittance alone rather
than being doubled by a current miss that the player has no way to fix.

## 5. The LWFA utility decision

The brief asked for a genuinely different profile: no RF waveguide, no cryo,
heavy electrical power and cooling, plus a petawatt-class drive laser. Delivered
as:

**`lwfaStation` sinks `powerCable` (420 kW), `coolingWater` (400 kW), and
`dataFiber` (8 Gbps).** No `rfWaveguide`, no `cryoTransfer`, no `rfFrequency`
bucket. A plasma wake is not a cavity and a plasma stage is warm, so both
absences are physics rather than flavour, and the test asserts them so a
future "make the big machines consistent" pass cannot quietly erase the one
thing that makes this machine play differently. It is the **only source in the
catalogue on the fibre network**: the fibre is the femtosecond laser-to-plasma
synchronisation link, which is genuinely what sets the energy jitter of every
bunch the station makes, and stabilised fibre distribution is exactly what
`dataFiber` models.

**`petawattLaser` is a new infrastructure placeable, not a reuse of
`laserSystem`.** The existing `laserSystem` is a 3 kW UV oscillator that
tickles a photocathode; the LWFA driver is a Ti:sapphire chirped-pulse chain
putting ~30 J into ~30 fs at a wall-plug efficiency of a fraction of a percent.
$18 M, 320 kW, 16 × 8 × 3 sub-units, gated on `plasmaAcceleration` alongside the
station. Its power and cooling sinks are auto-derived from `energyCost` by
`utility-ports-v2.js`'s infrastructure sink builder, which is correct here:
almost none of that 320 kW reaches the plasma and almost all of it comes
straight back as heat.

### The gap, stated plainly

There is **no `laserBeam` utility type**, and adding one would mean a new entry
in `src/utility/registry.js`, a solver module in `src/utility/types/`, pipe
rendering, and a palette tool — well outside a data-only change, and squarely
in files other work is live in. So *nothing mechanically forces an
`lwfaStation` to have a `petawattLaser` on the plot*. The `dataFiber` sink is
the only wire between them and it is a timing link, not a power link.

Two clean fixes when someone wants to close it, in preference order:

1. A seventh utility type (`laserBeam`), with `petawattLaser` as its only
   source and `lwfaStation` as its only sink. Exact-bucket matching then gives
   exclusivity for free, the way `rfWaveguide` frequency buckets already do.
2. A general "companion placeable required" rule on components — useful beyond
   this pair (`laserSystem` ↔ `dcPhotoGun`/`ncRfGun` has had the same dangling
   intent since those guns were written).

Routing the drive laser through `rfWaveguide` at an optical frequency was
considered and rejected: it works mechanically, but the player would see RF
waveguide runs on the map, which reads as a lie.

## 6. Files touched

| file | change |
|---|---|
| `src/data/beamline-components.raw.js` | five components in a new "Compound machines" block after `ecrIonSource` |
| `src/data/utility-ports-v2.js` | five port entries; five outgassing entries |
| `src/data/infrastructure.raw.js` | `petawattLaser` |
| `src/data/research.js` | `unlocks` added to `cyclotronTech`, `isochronousCyclotron`, `plasmaAcceleration` |
| `test/test-compound-machines.js` | new suite, 177 assertions |

`src/data/beamline-types.js` was **not** touched. Palette membership for these
machines is expressed entirely by the components' own `beamlineTypes`
allowlists, which is where the file's own header says special-purpose hardware
belongs; no type needed a new `excludes` entry, because none of the five is
general hardware that happens to be wrong somewhere.

## 7. Notes on the framing, for the record

Three things in the original brief turned out not to hold:

1. **`beamQuality` is not emittance-blind, it is emittance-inverted below
   ~100 MeV.** See §3.2. The conclusion for the LWFA is unchanged; the
   conclusion for the cyclotrons is the opposite of what a naive reading gives.
2. **`cockcroftWalton` cannot be a tier-1 revenue machine.** No proton beamline
   type's band comes within a factor of 20 of 750 keV. It ships as a front end,
   which is a coherent role, but "the tier-1 pair are low-tech revenue" is true
   of `vanDeGraaff` alone.
3. **`maxCount` is dead data.** The brief suggested considering it (the
   electron gun carries `maxCount: 2`), but nothing in `src/` reads the field —
   the only `maxCount` identifiers in the tree are local variables in the
   instanced-mesh builders. None of the compound machines declares one, since
   it would do nothing.
