# Utility-Driven Beam Physics — Design Spec

Date: 2026-08-11
Scope: `beam_physics/`, `src/utility/types/`, `src/game/utility-gate.js`,
`src/beamline/component-physics.js`, `src/data/utility-ports-v2.js`,
`src/game/economy.js`.

## Problem

The utility layer is well-built: real networks, a real solver, per-sink quality,
fail-closed gating. The *device physics* sitting on top of it is placeholder.
Every utility collapses to an abstract 0–1 scalar, and all four are applied as
one linear product (`gameplay.py:245`):

```python
el["energyGain"] *= power_q * rf_q * cooling_q * cryo_q
```

Consequences, each verified in the current tree:

1. **Energy gain is a flat per-component constant.** `gameplay.py:169` reads
   `stats.energyGain` directly. Element `length` is computed (`subL × 0.5`) and
   never used for acceleration. A cavity delivers the same energy whether it is
   fed 5 kW or 1 MW.
2. **Cryo has no temperature.** `cryoTransfer.js:57` computes
   `quality = min(1, coldCapacityW / srfHeatW)` — a capacity ratio. `srfHeatW`
   is a hard-coded constant per component, so a cavity's heat load does not
   depend on the field it is running at. There is no `T` anywhere in the tree.
3. **Quench is a reservoir boolean.** Tripped when LHe drops below 20 L
   (`cryoTransfer.js:38`), not by thermal runaway.
4. **RF enters linearly.** Cavity voltage goes as `√P`, not `P`. The exponent is
   simply wrong.
5. **Vacuum cannot affect beam quality.** `vac_q` narrows the aperture
   (`gameplay.py:257`), which feeds `aperture_loss`, which only scales
   `beam.current` and never touches `beam.sigma`. But
   `beam_quality = initial_eps / final_eps` (`lattice.py:219`) is a pure
   emittance ratio. **There is no code path from vacuum to beam quality.**
   Since clipping a Gaussian scrapes halo, the existing coupling is arguably
   backwards.
6. **Outgassing does not scale with length.** It is a 19-entry constant table
   keyed on component id (`utility-ports-v2.js:215`), and `drift`/`bellows` are
   absent from `BEAMLINE_UTILITY_PORTS`, so the vac_in injection loop at line
   229 skips them entirely. 500 m of beam pipe adds zero gas load. The loop's
   own comment claims "every segment of beam pipe needs vacuum".
7. **Two disagreeing pressure models.** `vacuumPipe.js:36` uses `P = Q/S`
   (correct) and drives the beam. `economy.js:249` uses
   `1e-6 / (S/V)` (volume-based, magic constant) and drives the HUD readout and
   the `goodVacuum` objective. The player reads one number; the beam responds to
   another.

Net effect: **provisioning barely matters.** Wire anything to anything, and the
beam is nearly as good as a correctly engineered facility.

## What is already good (do not regress)

The propagation core is sound and this spec builds on it rather than replacing
it: transit-time factor and capture efficiency (`rf_acceleration.py`), adiabatic
damping, RF-induced energy spread and chirp, space charge via generalized
perveance `K = 2I/(I_A β³γ³)` (`space_charge.py`), synchrotron radiation with
quantum excitation and the dispersion `H`-function (`synchrotron_rad.py`),
Gaussian aperture clipping via `erf` (`aperture_loss.py`).

Also already present and unused, which this spec exploits:
- `component-physics.js` computes `energyGain = gradient × length × cos(φ)` from
  a player-facing `gradient` slider in MV/m (lines 172–200, 585–605).
- `gameplay.py` already maps `undulator` (`period`, `kParameter`, `photonRate`),
  and `'undulator'` is already in `KNOWN_PHYSICS_TYPES`.
- `economy.js:354` already charges a Carnot penalty of 750 W/W at 2 K vs 250 at
  4.5 K.
- `computeSystemStats` already computes VSWR with nothing feeding it.

## Design

The organizing principle: **the player sets a demand; the plant decides what is
actually achievable.** Every slider becomes a request that the provisioned
hardware can refuse.

### 1. SRF: temperature → Q₀ → achievable gradient

Replace `cryoQuality` as a capacity ratio with a real thermal solve.

**Surface resistance and quality factor.** Standard Nb approximation:

```
R_BCS(T) = (A · f_GHz² / T) · exp(−Δ/T)     A = 2e-4, Δ/k_B = 17.67 K
Q₀(T)    = G / (R_BCS(T) + R_res)
```

**Achievable gradient**, dissipation-limited CW:

```
E_acc,max = √(P_rf · (R/Q) · Q₀) / L
```

**Dissipated power**, which is next tick's heat load — this closes the loop:

```
P_diss = (E_acc · L)² / ((R/Q) · Q₀)
```

Calibration against TESLA 9-cell constants (R/Q = 1030 Ω, G = 270 Ω,
L = 1.038 m, R_res = 10 nΩ, f = 1.3 GHz):

| T (K) | R_BCS (nΩ) | Q₀ | E_acc @ 42 W | P_diss @ 20 MV/m |
|---|---|---|---|---|
| 1.8 | 10 | 1.3e10 | 23.1 MV/m | 31 W |
| 2.0 | 25 | 7.8e9 | 17.7 MV/m | 54 W |
| 2.5 | 115 | 2.2e9 | 9.3 MV/m | 194 W |
| 3.0 | 312 | 8.4e8 | 5.8 MV/m | 499 W |
| 4.2 | 1198 | 2.2e8 | 3.0 MV/m | 1872 W |

These match real cavities (TESLA at 2 K: Q₀ ~1e10, 30–50 W dynamic at
20 MV/m), so the model is calibrated without free parameters.

**Per-component SRF constants** (new table, `beam_physics/srf.py`):

| Component | f (GHz) | R/Q (Ω) | G (Ω) | L_act (m) | n_cav |
|---|---|---|---|---|---|
| `cryomodule` | 1.3 | 1030 | 270 | 1.038 | 8 |
| `ellipticalSrfCavity` | 0.65 | 380 | 190 | 0.72 | 1 |
| `srf650Cavity` | 0.65 | 380 | 190 | 0.72 | 5 |
| `spokeCavity` | 0.325 | 220 | 110 | 0.46 | 1 |
| `halfWaveResonator` | 0.161 | 275 | 50 | 0.30 | 1 |

`R_res` defaults to 10 nΩ and is the natural hook for future SRF research
(N-doping, improved surface prep) — lower `R_res` raises Q₀ at fixed T.

**Thermal model.** `cryoTransfer.solve()` gains persistent `tempK`.

An earlier draft of this spec proposed solving for an equilibrium temperature
by bisection. **That was wrong and the implementation does not do it.**
Dissipation goes as `1/Q0`, which climbs far faster with temperature than any
plant's capacity does, so `capacity − load` is monotonically *decreasing* and
never re-crosses zero — there is no interior equilibrium to find. Measured for
one cryomodule at 20 MV/m against a 250 W plant: load is 251 W at 1.8 K, 429 W
at 2.0 K, 3,989 W at 3.0 K and 18,477 W at 4.5 K, while capacity only rises
from 76 W to 250 W across the same span.

The physically correct model is a **design temperature**: a helium bath sits at
the temperature the pressure above it dictates, and a 2 K plant holds 2 K. Load
decides whether the plant can *maintain* that, not what temperature it settles
at. So the bath holds `T_design` while capacity covers load, and warms when it
does not, driven by net heat:

```
T_design = 2.0 K with a coldBox2K on the network, else 4.5 K
dT/dt    = (load(T) − capacity(T)) / THERMAL_MASS
T        = clamp(T + dT, T_design, T_c)
```

Warming accelerates on its own as `Q0` collapses, so `THERMAL_MASS` effectively
sets the whole warning window. Measured with one cryomodule on a 300 W plant:
a hard over-drive (25 MV/m) quenches at tick 21, a moderate one (22 MV/m) at
tick 29, and a mild one (16 MV/m) never quenches. Sustained over-driving is
fatal, but always with time to react.

**Quench** becomes thermal: reaching `T_c = 9.25 K` trips `cryoQuenched`. The
existing LHe-reservoir quench is retained as a second, independent cause.

**Quench must not latch.** A quenched cavity contributes *no* dynamic load,
because the machine-protection interlock drops its RF the moment it goes
normal-conducting. Without that, `Q0` falls to the copper value, dissipation
goes to megawatts, and the bath can never come back down no matter what the
player does.

**The runaway loop, emergent rather than scripted:** player raises demanded
gradient → `P_diss` rises → plant cannot hold 2 K → T climbs → Q₀ collapses →
`P_diss` rises faster → quench. Counter-pressure already exists in the Carnot
penalty: 2 K buys 35× the Q₀ at 3× the electricity per watt removed, so the
operating point is a genuine choice rather than a strictly-better setting.

### 2. RF: `√P`, and pulsed vs CW

Achievable gradient for **normal-conducting** cavities, standing-wave:

```
E_acc,max = √(P_peak · r_shunt / L)         r_shunt in Ω/m
```

Verification: S-band, r = 55 MΩ/m, L = 3 m, P = 30 MW → 23.5 MV/m. SLAC runs
~20 MV/m at 35 MW. Correct to within the accuracy this game needs.

**Duty factor** reconciles game-scale RF capacities (kW) with the MW peak power
NC structures need. RF sources gain a `dutyFactor` param; peak power is
`P_avg / dutyFactor`. A pulsed klystron at 50 kW average and 0.1% duty delivers
50 MW peak.

This makes pulsed vs CW a real strategic axis rather than flavour text, and it
maps directly onto machine purpose: pulsed gives huge peak gradient at low
average current (FEL, brightness); CW gives steady average current at lower
gradient (spallation, average beam power).

**NC constants** (`beam_physics/srf.py`, same table): `rfCavity` 2.856 GHz
r = 55 MΩ/m; `sbandStructure` 55; `cbandCavity` 90; `xbandCavity` 110;
`pillboxCavity` 30; `rfq` 25.

### 3. Cooling: detune, not fade

For NC cavities, undercooling causes thermal expansion, which detunes the cavity
off resonance. Coupled power fraction is Lorentzian:

```
ΔT     = f(cooling capacity deficit)
Δf     = −k_detune · ΔT                      k ≈ 20 kHz/K at S-band
couple = 1 / (1 + (2 Q_L Δf / f)²)
P_eff  = P_fwd · couple
```

An undercooled cavity does not gently fade — it falls off resonance and reflects
power back at the klystron. The reflected fraction `1 − couple` feeds the VSWR
readout `computeSystemStats` already computes and currently has no input for.

SRF cavities route cooling deficits into the cryo model instead (§1); they have
no separate water loop.

### 4. Vacuum: length-scaled outgassing and beam-gas scattering

**Outgassing from surface area.** Computed from real geometry: at the existing
`pipeRadiusMeters: 0.06`, surface area is 3770 cm²/m.

`bellows` gets a `vac_in` port. **`drift` deliberately does not.** It is a drawn
connection — the beam pipe itself — and never exists as a placeable, so a port
declared on it could never be discovered into a network and its outgassing
would be silently dropped. Beam-pipe surface area is instead added directly by
the vacuum solver, which can see `state.beamPipes` and charges each pipe to
whatever pumps serve the components mounted on it. Since length is the dominant
term on any real machine, it has to be counted somewhere that actually runs.

| Surface | q (mbar·L/s/cm²) | Q per metre |
|---|---|---|
| Unbaked stainless | 1e-10 | 3.8e-7 |
| Baked UHV | 1e-12 | 3.8e-9 |

One metre of unbaked pipe outgasses roughly as much as an entire component does
today. Through the solver's existing `P = Q/S` and log-linear quality map:

| Length | 1 pump (100 L/s) | 4 pumps (400 L/s) |
|---|---|---|
| 20 m | 0.78 | 0.93 |
| 100 m | 0.61 | 0.76 |
| 300 m | 0.49 | 0.64 |

Baked, all of these reach ~1.00.

Three consequences fall out: long beamlines need **distributed pumping** (today
one pump serves any length); `bakeoutSystem` — already in the tree, already
counted in `computeSystemStats`, with zero gameplay effect — becomes a real
100× upgrade; and long empty drift runs finally cost something, which is what
the `economy.js` density-vs-length note already argues they should.

**Beam-gas scattering.** New module `beam_physics/modules/beam_gas.py`,
`applies_to` everything with length > 0, supplying the missing vacuum → quality
link:

```
emittance growth:  Δε_n = C_scatter · P · L · β_twiss / (βγ)
current loss:      I *= exp(−L / λ(P)),   λ ∝ 1/P
```

The `1/(βγ)` scaling means low-energy beams are far more vulnerable, so the
injector is what needs protecting — correct physics, and a useful asymmetry to
design around.

This is the change that makes vacuum reach `beam_quality`, and therefore income.

**Aperture proxy removed.** `gameplay.py`'s `aperture *= (0.5 + 0.5·vac_q)` is
deleted; real scattering replaces it. The research `vacuumQuality` effect keeps
its aperture-widening role.

**Pressure model unified.** `economy.js`'s `avgPressure` is replaced by the
solver's `P = Q/S`, read from `utilityNetworkData`. One pressure, one formula.
The `goodVacuum` objective then keys on the number that actually drives the beam.

### 5. Power: unchanged

`focusStrength *= power_q` stays linear. For a current-limited magnet supply,
`k ∝ I ∝ P`, so linear is already correct. No change.

## Data flow

The circular dependency (heat depends on gradient, gradient depends on
temperature) resolves with a **one-tick lag** — explicit-Euler coupling:

```
tick N:   cryoTransfer.solve() reads last tick's achieved gradients from
          state.placeables → computes load → relaxes T → writes tempK into
          persistent state and per-sink cryoTempK
          ↓  utility-gate._aggregateNodeQualities
          nodeQualities[id].cryoTempK
          ↓  Game.js:2834
          physEl.infraQuality.cryoTempK
          ↓  gameplay.py
          Q₀(T) → E_acc,max → energyGain = min(demanded, achievable) · L · cos φ
          ↓
tick N+1: achieved gradient feeds the next thermal solve
```

`cryoTransfer.solve()` already receives `worldState`, so it can read placeable
params without new plumbing. `rfWaveguide.solve()` is extended to expose
per-sink available power (W) alongside its existing quality scalar.

All new `infraQuality` fields are **fail-closed** in the same way existing ones
are: a declared sink with no solved value resolves to the worst case
(`cryoTempK` → 300 K, `rfPowerW` → 0), never to a permissive default.

## Player-facing consequences

- The `gradient` slider gains a **hard ceiling** drawn from provisioning. Demand
  25 MV/m on a cavity fed 5 kW at 4.5 K and you get 3. The BeamlineWindow shows
  demanded vs achievable and which resource is binding.
- Cryo temperature becomes a live readout that climbs under load.
- Quench is something the player causes by over-driving, with visible warning.
- Long beamlines need pumps distributed along them.
- Bakeout is worth buying.
- Pulsed and CW RF become genuinely different engineering choices.

## Testing

- **Unit, Python:** `Q₀(T)` and `E_acc` reproduce the calibration table above
  within 5%. `P_diss(E_acc(P)) == P` round-trips. Beam-gas emittance growth
  scales linearly in `P·L` and inversely in `βγ`.
- **Unit, JS:** thermal bisection converges on monotonic load/capacity curves;
  relaxation is stable and never oscillates. Outgassing scales linearly with
  drift length.
- **Integration:** an under-provisioned SRF linac quenches within N ticks; the
  same linac with adequate plant holds 2 K indefinitely. A 300 m unbaked
  beamline with one pump reports quality ≈ 0.49; adding bakeout takes it to
  ~1.00.
- **Regression:** the three invariants in `test/test-economy-balance.js` must
  still hold after rebalancing.
- **Fail-closed:** every new `infraQuality` field defaults to worst-case when
  unsolved, verified by the existing gate tests.

## Balance

The design target was that a *correctly provisioned* facility lands close to
today's output while an under-provisioned one is clearly worse. The
implementation achieves this **exactly**, by construction, and no rebalance was
needed:

- Demanded gradient is always back-derived from the element's catalogue
  `energyGain` over its own physics length, and the achieved gradient converts
  back through the same length. So when provisioning is adequate,
  `achieved == demanded` and the cavity delivers its catalogue energy gain to
  the last digit.
- `stats.gradient` is deliberately **not** read, even where components carry
  one. It is a second source of truth that disagrees: `pillboxCavity` ships
  `energyGain` 0.00035 GeV next to `gradient` 0.5 MV/m over a 1.0 m element —
  0.35 vs 0.5 MV/m, two different machines. Reading it made a well-provisioned
  cavity deliver 71% of its catalogue energy, silently rebalancing the game.

Verified end to end on `smallBeamlineFacility`: the wired scenario produces
**301.80 keV both before and after** this change, bit-identical. Starving the
same beamline's RF to 200 W drops it to 188 keV.

The catalogue turned out to be *compatible* with the physical model rather than
in tension with it — every cavity's catalogue gradient (cryomodule 25 MV/m,
rfCavity 15, sbandStructure 17, spokeCavity 5) sits comfortably below what good
provisioning allows, so the ceiling binds only when the player under-builds.

`ECON`'s capital-payback derivation therefore stands unchanged, and all three
invariants in `test/test-economy-balance.js` still hold. Run C of
`scripts/balance-sim.mjs` reports 1970.1/t upkeep against the 1970/t quoted in
the `ECON` comment.

## Out of scope

Beamline types and figures of merit (separate spec, consumes this one).
Customer contracts. Ring and collider topology. New components beyond the
`drift`/`bellows` vacuum ports required here.
