# Primary beamline review — 7 September 2026

## Verdict

The ten mission families make a useful roster, but the last four are not yet
complete production/science loops. All 30 stock designs meet their transport
bands; only 18 pass the new necessary mission-output checks. This distinction
matters before calibrating a 10–20-hour route to late-game machines.

Measured with native Python physics, authored tuning, and ideal utilities using
`node scripts/eval-design.mjs --json`. Full readings are in
[the results](2026-09-07-beamline-types-results.json). These are design checks,
not a buildability, staffing, utility-budget, or elapsed-progression playtest.

## Mission-by-mission review

| Family | Working chain / existing hardware | Missing behavior or component work |
| --- | --- | --- |
| Test stand | Electron gun, capture/acceleration, focusing, BPM/current diagnostics, Faraday cup or materials station. All three produce data. | Good opening mission. Materials experiments need distinct assignments; all stock versions currently hit the same 0.1 data floor. Keep the cheap cup useful for commissioning. |
| E-beam processing | Industrial linac, X-ray converter or irradiation vault; the vault already packages scanning and dosimetry. Three upgrades improve paid power. | Product throughput, conveyor speed and absorbed dose are not separate simulation quantities. Expose those before adding a redundant standalone scanner requirement. |
| Isotopes / irradiation | Proton source, transport, isotope target or radiation-effects station; standalone scanning magnet exists. | These are two different outputs: isotope yield versus field uniformity/fluence. Revenue currently uses energy × current for both and ignores the authored 5–50 mm spot band. Add target material/yield and a scan/dose model; then distinguish their contracts. |
| Therapy | Tunable linac or fixed-energy cyclotron, energy selection, scanning, gantry with integrated delivery equipment. Three stock linacs deliver data at 70, 145 and 232 MeV. | The degrader subtracts energy relative to an assumed 230 MeV input and is represented as RF, including RF capture/transit-time effects. It needs a passive, incoming-energy-aware material model. The 230 MeV source emits exactly the mission's minimum current before losses. Mission text says nanoamps while its band is 1–50 microamps. Reconcile source, treatment-plane current, range and dose monitoring together. |
| Spallation | Proton front end, staged linac, high-power neutron target. Stock data rises from 1.58 to 7.56. | Target event yield is generic. Add a moderator/instrument station and useful neutron flux before promising “twenty instruments.” Pulse duty is a mission constant, not a constructed timing/accumulator system. An accumulator should be optional for appropriate source designs. |
| Synchrotron light | Injector, injection septum/kicker, ring hardware, insertion devices and photon hutch. Photon readings are positive. | Stored current uses a fixed accumulation multiplier/cap. Photon transport and user branches are not independent optical paths, and stock hutch data remains at 0.1. Add a photon front end (shutter/slits), spectral optics and separate experimental branches; validate lifetime and top-up behavior. |
| Hard X-ray FEL | Low-emittance source, acceleration, available compression/undulators, XFEL endstation. | All three stocks remain unsaturated with approximately 1 mW reported peak power after the units fix. Gain restarts at each undulator; no propagated radiation state links sections. Need a functioning injector/compression match, cumulative gain, photon/electron separation and photon diagnostics. |
| EUV FEL | High-current electron linac, undulators and EUV collector; a return-arc component exists. | All three stocks remain unsaturated near 1 mW peak, despite receiving an availability contract. Peak power is not average in-band collector power. Need cumulative gain, actual recovery of RF/beam energy, wavelength acceptance, collection losses and a contract tied to delivered light. A research unlock/return-arc label alone does not establish recovery. |
| Linear collider | Electron accelerator and final focus terminating at a two-entry collision point. | All three stocks have zero luminosity and zero data: `collisionPoint` maps to `drift`, so the beam-beam module never runs. Changing the label to `detector` alone would incorrectly invent the second beam. Implement two running, compatible opposing arms, shared interaction-region evaluation and detector readout before scoring collisions. |
| Black Hole Factory | Speculative hadron acceleration, final focus and chamber mapped to detector physics. | Stock delivered currents are approximately 2.9e-245 mA, zero, zero; all yields and data are zero. First repair transmission, opposing-beam collision semantics and loss diagnostics. Keep predicted black-hole production explicitly speculative; a high energy number alone is not an operating frontier machine. |

## Contained fixes in this review

- Endpoint billing now enforces the mission's endpoint contract at execution,
  including imported/saved layouts; a test stand cannot bill a therapy gantry.
- Dead, zero-current and non-finite beams cannot bill availability contracts.
- FEL saturation power now converts GeV × amperes to watts correctly. The old
  expression multiplied energy per electron in joules by charge per second,
  omitting division by the elementary charge. The efficiency model is still
  approximate. The relation between saturation efficiency and rho is described
  by [DESY's FEL introduction](https://photon-science.desy.de/research/students__teaching/sr_and_fel_basics/fel_basics/tdr_from_synchrotron_radiation_to_a_sase_fel/index_eng.html).
- Native design exports now include FEL power, wavelength, gain length and
  predicted frontier yield, exposing failures hidden by energy/current bands.
- `--mission-output` adds an explicit necessary-output audit and exits nonzero
  for missing data, photons, saturation, luminosity or frontier yield. Default
  transport-band validation remains separate. A passing necessary-output audit
  does not certify dose safety, EUV average power, two-arm topology or economics.

## Work order

1. Make treatment/irradiation delivery coherent: passive degrader, scanning and
   dose/field monitoring; separate isotope yield from radiation-test fluence.
2. Make photon machines deliver photons: cumulative FEL radiation state,
   average/peak units, photon extraction and instrument branches. Fix billing
   only against those published quantities. `lattice.py` currently adds FEL
   watts × 1e-6 to synchrotron photons/second in `photonRate`; that mixed-unit
   quantity must not become the basis for a new physical contract.
3. Make colliders actual two-arm experiments, then establish viable frontier
   transmission. Do not grant discoveries from installed endpoint hardware.
4. Calibrate progression time against working mission outputs and construction
   costs. Neither the band checks nor this review establish a 10–20-hour climb.

The new component priorities are dose/field monitors, neutron instrument
stations, photon front ends/optics, and collision detector readout. Several
already-authored components need functional models before more catalogue
entries would improve the game. This review does not claim those larger
subsystems are implemented.

## Validation

Focused endpoint and FEL regression tests; native evaluation of all 30 designs;
fast tests, simulation tests and production build. Integration additionally runs
the complete non-browser suite. No browser operation or master promotion.
