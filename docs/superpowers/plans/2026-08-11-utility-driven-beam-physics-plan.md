# Utility-Driven Beam Physics — Implementation Plan

Spec: `docs/superpowers/specs/2026-08-11-utility-driven-beam-physics-design.md`

**Status: implemented.** Four things went differently from the plan below and
the spec has been corrected to match; they are flagged inline as CHANGED.

1. The cryogenic solve uses a design-temperature bath plus a thermal ODE, not
   bisection for an equilibrium — there is no interior equilibrium to find.
2. `drift` gets no vacuum port; beam-pipe outgassing is added by the solver.
3. Demanded gradient is always derived from catalogue `energyGain`, never from
   a `gradient` param/stat.
4. Solvers use a new lightweight `endpoint-lookup.js` rather than
   `listUtilityEndpoints`, which would close an import cycle.

Ordering rule: Python device model first (self-contained, testable in isolation),
then the JS solvers that feed it, then the couplings, then UI, then balance.
Each phase leaves the tree runnable.

---

## Phase 1 — SRF/NC device model (Python, self-contained)

**New file `beam_physics/srf.py`.**

Constants table `CAVITY_SPECS`, keyed on game component id. SRF entries carry
`{kind: 'srf', f_ghz, r_over_q, G, l_active, n_cav, r_res_default}`; NC entries
carry `{kind: 'nc', f_ghz, r_shunt_ohm_per_m, l_active, n_cav}`. Values from the
spec's two tables.

Functions:
- `r_bcs(T, f_ghz)` — `(A f²/T)·exp(−Δ/T)`, `A = 2e-4`, `Δ = 17.67`.
- `q0(T, spec, r_res=None)` — `G/(R_BCS + R_res)`. Clamp `T` to ≥ 1.5 K.
- `e_acc_max(p_watts, spec, T=None)` — SRF: `√(P·(R/Q)·Q₀)/L`. NC:
  `√(P·r_shunt/L)`. Returns MV/m. Per-cavity, not per-module.
- `p_diss(e_acc_mv_m, spec, T)` — `(E·L)²/((R/Q)·Q₀)`, watts **per cavity**;
  callers multiply by `n_cav`.
- `T_CRITICAL = 9.25`.

Note the unit trap: `e_acc_max` and `p_diss` work per cavity; module-level
energy gain and heat load both scale by `n_cav`.

**Test `test/test_srf.py`** (pytest, alongside existing Python tests):
- `q0`/`e_acc_max` reproduce the spec calibration table within 5%.
- `p_diss(e_acc_max(P)) ≈ P` round-trips to 1e-6 relative.
- `q0` is monotonically decreasing in T; `e_acc_max` monotonically increasing
  in P.

**Acceptance:** table reproduced within 5%; round-trip holds.

---

## Phase 2 — Achievable gradient in the physics pass

**`beam_physics/gameplay.py`:**

In `beamline_config_from_game`, for `rfCavity`/`cryomodule` physics types, when
the component has a `CAVITY_SPECS` entry:

1. CHANGED — ALWAYS derive demanded gradient from the effective `energyGain`
   over the element's own physics length (`subL x 0.5`). Never read
   `params.gradient` / `stats.gradient`: they are a second source of truth that
   disagrees (pillboxCavity ships 0.00035 GeV next to 0.5 MV/m over 1.0 m), and
   deriving from energyGain makes the balance guarantee exact.
2. Read `infraQuality.rfPowerW` (per-cavity share: total / `n_cav`) and
   `infraQuality.cryoTempK`.
3. `achieved = min(demanded, e_acc_max(...))`.
4. CHANGED — `el["energyGain"] = achieved · el["length"] / 1000` (GeV), the same
   length the demand was derived from, so `achieved == demanded` returns the
   catalogue value exactly. `l_active · n_cav` is used only for the per-cavity
   `e_acc_max` / `p_diss` maths, where it is real hardware geometry rather than
   grid footprint. `cos(φ)` is applied downstream in `rf_acceleration.py`,
   which already does it. **Do not double-apply.**
5. Stamp `el["gradientDemanded"]`, `el["gradientAchieved"]`, `el["pDissW"]`,
   `el["q0"]` for UI and for the next thermal solve.

Replace the linear derate. `power_q` keeps its linear multiplier on
`focusStrength` only. `rf_q`/`cryo_q`/`cooling_q` no longer multiply
`energyGain` — they now act through `rfPowerW`, `cryoTempK`, and the detune
factor respectively. Components with no `CAVITY_SPECS` entry keep the old linear
path as a fallback so nothing silently zeroes.

Keep `cryoQuenched` → drift conversion; add `cryoTempK > T_CRITICAL` as a second
trigger.

**Surface results:** add `gradientAchieved`, `gradientDemanded`, `cavityQ0`,
`pDissW` per element to `physics_to_game`'s envelope entries.

**Acceptance:** a cryomodule at 2 K with ample RF reaches its demanded gradient;
the same at 4.5 K is capped near 3 MV/m; existing beamlines still propagate.

---

## Phase 3 — Cryo thermal solve (JS)

**`src/utility/types/cryoTransfer.js`:**

Add `tempK: 4.5` to `persistentStateDefaults`. Add `RELAX = 0.15`,
`T_MIN = 1.8`, `T_CRITICAL = 9.25`.

Add a plant capacity curve: a cold box rated `coldCapacityW` at its design
temperature delivers less at lower T. Use `cap(T) = coldCapacityW · (T/T_design)^2.5`
clamped to `[0, coldCapacityW·1.5]`, `T_design = 4.5`. This is what makes 2 K
expensive in *capacity* as well as in wall power.

In `solve()`:
1. From `worldState`, for each sink placeable read its last achieved gradient
   (stamped by the physics pass onto the placeable) and its `CAVITY_SPECS`
   mirror (see Phase 3a) to compute `P_diss` at the current `tempK`.
2. `load = staticLoad + Σ P_diss·n_cav`, where `staticLoad` keeps the existing
   `srfHeatW` declarations as the static-only term.
3. CHANGED — no bisection. `capacity - load` decreases monotonically in T, so
   there is no interior equilibrium. Instead: design temperature from the plant
   hardware (coldBox2K → 2.0 K, coldBox4K → 4.5 K), and
   `tempK += (load - capacity) / THERMAL_MASS`, clamped to
   `[T_design, T_CRITICAL]`. THERMAL_MASS = 20000 gives a 21-29 tick warning
   window under over-drive.
4. CHANGED — a quenched cavity contributes zero dynamic load (the RF interlock
   drops), otherwise the quench latches and can never be recovered.
5. Emit per-sink `cryoTempK` alongside `perSinkQuality`. Keep `quality` for
   backward compatibility, derived as `clamp(cap/load, 0, 1)`.
6. Boil-off keys off the *computed* load, not the declared constant.

**New `src/beamline/cavity-specs.js`** (Phase 3a): the same `CAVITY_SPECS` table
and `q0`/`p_diss` helpers in JS. Duplicated deliberately — the JS solver runs
every tick and cannot call into Python.

**New `src/utility/endpoint-lookup.js`** (CHANGED): solvers need `id -> {type,
gradientAchieved}` but must NOT import `listUtilityEndpoints`, which resolves
placement geometry via COMPONENTS -> validate.js -> the utility registry ->
back to the solvers. That cycle leaves the registry uninitialised. This module
walks `state.placeables` and `pipe.placements` with no heavy imports.

**Guard against drift:** `test/test-cavity-specs.js` asserts the JS and Python
tables agree key-for-key and value-for-value by parsing both files. A silent
divergence here would make the thermal solve disagree with the physics pass.

**`src/game/utility-gate.js`:** carry `cryoTempK` through
`_aggregateNodeQualities` (min across networks, as with quality); fail-closed
default 300 K in `sinkQualityFloorFrom`.

**Acceptance:** an over-driven cryomodule climbs in temperature over successive
ticks and quenches; a well-provisioned one settles at 2 K. No oscillation.

---

## Phase 4 — RF power exposure (JS)

**`src/utility/types/rfWaveguide.js`:** expose per-sink available power in watts
alongside quality — total network capacity apportioned across sinks by their
declared demand, so an over-subscribed network starves every cavity
proportionally. Multiply by `1/dutyFactor` for peak power.

**`src/data/utility-ports-v2.js`:** add `dutyFactor` to RF source params.
Pulsed klystron 0.001; CW klystron, IOT, SSA, gyrotron 1.0; magnetron 0.01.

**`utility-gate.js`:** carry `rfPowerW`, fail-closed 0.

**Acceptance:** a pulsed klystron at 50 kW average yields 50 MW peak; two
cavities on one 50 kW CW source each see 25 kW.

---

## Phase 5 — Cooling detune (NC only)

**`src/utility/types/coolingWater.js`:** compute `ΔT` from the capacity deficit
and emit per-sink `coolingDeltaT`.

**`beam_physics/srf.py`:** add `detune_coupling(delta_t, spec, q_loaded=1e4)` —
`Δf = −20e3·ΔT` (Hz/K at S-band, scaled by `f/2.856`), Lorentzian
`1/(1+(2·Q_L·Δf/f)²)`.

**`gameplay.py`:** for NC cavities, `P_eff = rfPowerW · detune_coupling(...)`
before computing `e_acc_max`. Stamp `el["reflectedFraction"] = 1 − coupling`.

SRF cavities ignore `coolingDeltaT` — their thermal path is the cryo model.

**`economy.js`:** feed `reflectedFraction` into the VSWR readout instead of the
hard-coded `reflFraction = 0.02`.

**Acceptance:** an undercooled S-band structure loses gradient *and* shows
elevated VSWR.

---

## Phase 6 — Vacuum: length-scaled outgassing

**`src/data/utility-ports-v2.js`:**
- CHANGED — `bellows` only. `drift` is a drawn connection and never a
  placeable, so a port on it would never be discovered; beam-pipe outgassing is
  added by the vacuum solver from `state.beamPipes` instead, charged to the
  pumps serving the components on each pipe. Drive the vac_in injection loop
  off COMPONENTS (skipping `isDrawnConnection`) rather than the port table's
  own keys.
- Replace the flat `VACUUM_OUTGASSING` constants with area-derived values:
  `Q = q_specific · 2π·r·L_m·1e4` cm². `q_specific` defaults to `1e-10`
  (unbaked); `1e-12` when a `bakeoutSystem` is present on the network.
- For `drift`, outgassing must scale with the placed length (per sub-unit ×
  `subL`), not per instance.

**`src/utility/types/vacuumPipe.js`:** accept a per-network `baked` flag derived
from `bakeoutSystem` presence among sources; apply the 100× reduction. The
`P = Q/S` core and quality map are already correct — do not touch them.

**Acceptance:** the spec's length/pump-count quality table is reproduced;
placing a bakeout system takes a 300 m line from ~0.49 to ~1.00.

---

## Phase 7 — Beam-gas scattering module

**New `beam_physics/modules/beam_gas.py`**, `order=35` (after space charge,
before synchrotron radiation).

`applies_to`: any element with `length > 0` and a solved `pressure`.

`apply`:
- Emittance growth `Δε_n = C_scatter · P · L · β_twiss / (βγ)`, added to
  `beam.sigma[0,0]`/`[2,2]` scaled by `β_twiss` in the same idiom
  `synchrotron_rad._apply_dipole` uses for `d_eps_x`.
- Current loss `beam.current *= exp(−L/λ)`, `λ = λ_ref · (P_ref/P)`.
- Calibrate `C_scatter` and `λ_ref` so 1e-9 mbar over 100 m is negligible
  (< 1% emittance growth) and 1e-5 mbar over 100 m is severe (> 2× growth).

Register in `machines.py` `_TIER1_MODULES` so every machine type gets it.

**`gameplay.py`:** stamp `el["pressure"]` from `infraQuality.vacuumPressure`
(new field carrying the solver's `P` directly, replacing the 0–1 `vacuumQuality`
for this purpose). Delete the `aperture *= (0.5 + 0.5·vac_q)` proxy. Keep the
research `vacuumQuality` aperture widening.

**`utility-gate.js` / `vacuumPipe.js`:** emit per-sink `vacuumPressure`;
fail-closed 1013 mbar.

**Acceptance:** vacuum now moves `beamQuality`. A 100 m line at 1e-5 mbar shows
materially worse emittance than the same line at 1e-9.

---

## Phase 8 — Unify the pressure model

**`src/game/economy.js`:** delete the `1e-6 / max(S/V, 0.01)` formula in
`computeSystemStats`. Read the solver's pressure from `state.utilityNetworkData`
(worst across vacuum networks). Keep the `pressureQuality` banding.

Check `src/data/objectives.js` `goodVacuum` still triggers sensibly against the
new number; adjust the threshold if not.

**Acceptance:** HUD pressure and beam-affecting pressure are the same number.
The pump-placed-and-wired-to-nothing exploit noted in the `economy.js` comment
stays closed.

---

## Phase 9 — UI readouts

**`src/ui/BeamlineWindow.js`:** per-cavity row showing demanded vs achieved
gradient and the binding constraint (RF-limited / cryo-limited / at demand).
Facility-level cryo temperature with a warning band above 4 K and an alarm
approaching `T_CRITICAL`.

**`src/ui/UtilityStatsPanel.js`:** cryo panel reports live `tempK`, computed
load vs capacity, and margin. Vacuum panel reports solver pressure and whether
the network is baked.

Follow existing panel idioms; no new UI framework.

---

## Phase 10 — Balance pass

Re-derive `ECON.beamIncomePerNode` against a **correctly provisioned** reference
facility so today's playthrough-length target survives, per the spec's balance
section. Under-provisioned facilities are expected to earn materially less —
that is the intended outcome, not a regression.

Re-run `scripts/balance-sim.mjs`. Confirm
the three invariants in `test/test-economy-balance.js`. Update the `ECON`
derivation comment to reflect the new basis — it is load-bearing documentation
and must not be left describing the old model.

---

## Verification

Full `npm test` plus the Python suite green. Manual: build an SRF linac,
under-provision the cryoplant, watch temperature climb and gradient collapse;
add plant capacity, watch it recover.
