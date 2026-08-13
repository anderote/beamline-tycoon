// src/data/stock-designs/photon-ring.js — Synchrotron Light Source.
//
// The one ring in the roster, and the only type whose blueprints have to think
// about a beam that must survive for eight hours rather than one pass. See
// ../stock-designs.js for the entry shape and the authoring rules.
//
// ── NO BLUEPRINTS SHIP FOR THIS TYPE ───────────────────────────────────────
//
// Not for want of a lattice. The energy band is easy — 2.98 GeV and 5.76 GeV
// were both measured, in band, at beam quality 1.00, with capture-only loss.
// The CURRENT band is unreachable by any design this type is allowed to build,
// and the gap is a factor of three and a half at the very best operating point
// found by an exhaustive scan. Same call spallation makes in ./proton.js: a
// blueprint that cannot land in band is not content, it is a bug report with a
// price tag.
//
// Everything below was measured with `node scripts/eval-design.mjs`, driving
// candidate designs through the real engine.
//
//   1. THE BAND FLOOR IS ABOVE THE SOURCE CEILING. Two sources are allowlisted
//      to lightSource and no others: `lwfaStation`, which delivers 1 uA, and
//      `source`, the 5 kW constant-power thermionic gun, where I = 5000/V mA
//      and PARAM_DEFS floors the extraction voltage at 25 kV. So 200 mA is the
//      most current that has ever existed anywhere in a lightSource beamline,
//      and it exists only at the gun's flange, at 25 keV.
//
//      Then the first RF element takes its cut. rf_acceleration.py multiplies
//      the beam current by CAPTURE_EFFICIENCY once, at the first cavity the
//      beam meets, and nothing downstream ever gives it back. The best capture
//      on this type's palette is the buncher's 0.65; the cryomodule family and
//      the pillbox are 0.50, C-band 0.42, X-band 0.40. That puts the ARITHMETIC
//      ceiling at 200 x 0.65 = 130 mA against a 200 mA floor, before a single
//      metre of transport, before a single aperture.
//
//      And 130 mA is not reachable either, because a 25 kV / 200 mA DC beam is
//      302 mm across by the time it arrives at a cavity one tile downstream —
//      the space-charge perveance goes as I / (beta gamma)^3 and 25 keV is the
//      worst of both. Best measured over a full scan of extraction voltage
//      (25-80 kV), solenoid field (3-12 mT, 0.1 mT steps), solenoid count and
//      pre-buncher choice (none / pillbox / buncher):
//
//          42 kV, one solenoid at 0.005 T, capture on the first cwCryomodule
//          -> 2.98 GeV, 56.43 mA, q 1.00, loss 0.526 (0.500 of it capture)
//
//      56.43 mA. The floor is 200. Every neighbouring operating point is worse,
//      and most are catastrophically worse — the solenoid is oscillatory in the
//      way electron-low.js documents, so 0.0049 T gives 55.9 mA and 0.0055 T
//      gives 5.4.
//
//      The deeper reason is that a ring's 200-500 mA is a STORED current,
//      accumulated over thousands of injection cycles, and this engine models
//      one pass. lattice.py's `final_current` is the propagated beam and it
//      only ever falls. Injecting 56 mA per shot into a ring is a perfectly
//      respectable machine; the band is simply asking a single-pass number to
//      report a multi-turn one. Fixing this is a beamline-types.js or an
//      engine decision, not a blueprint one, which is why nothing is shipped
//      here rather than something out of band being shipped with an apology.
//
//   2. THE TYPE'S FIGURE OF MERIT IS STRUCTURALLY ZERO. `fom: 'photonFlux'`
//      reads photonRate, and lattice.py accumulates photonRate from ONE place:
//      reports whose module is `fel_gain`. machines.py deliberately withholds
//      the "fel" capability from lightSource — correctly, a storage ring has no
//      undulator gain — and its comment says "Light output arrives with the
//      synchrotron_light module". There is no synchrotron_light module in
//      beam_physics/modules/. SynchrotronRadiationModule runs, and it takes
//      energy OUT of the beam in every dipole, combined-function magnet and
//      undulator, but it reports `energy_loss` and no rate.
//
//      Measured: every candidate here, with up to three undulators, reported
//      photonRate 0.00e+0. A light source that emits no light scores zero on
//      the only axis it is scored on, so even an in-band blueprint would
//      advertise a machine that earns nothing.
//
//   3. THE TYPE'S OWN GATE DOES NOT REACH ITS OWN BAND FLOOR. lightSource
//      requires `srfTechnology`, and beamline-types.js explains that gate as
//      buying an injector good enough to reach 2.5 GeV. What srfTechnology
//      actually buys is `cryomodule`, whose DESIGN_BETA is 0.65 — a number
//      rf_acceleration.py itself flags as looking wrong for TESLA 9-cells and
//      leaves alone. Measured against a real gun beam it delivers 0.101 GeV a
//      placement, not the catalogue's 0.200: fourteen of them make 1.42 GeV,
//      eighteen make 1.82, and the beam is 242 mm across by then because
//      eighteen 8 m modules is 144 m of unfocused line. The band floor is
//      roughly twenty-five modules and $300M away, on the tier-1 rung.
//
//      Reaching 2.5 GeV in a sane number of placements needs `cwCryomodule`
//      (0.497 GeV measured against 0.500 nominal — beta 0.999, full value) and
//      therefore `cryomoduleDesign`, which the type does not require.
//
//   4. THE COPPER RUNGS ARE RF-POWER-STARVED IN THE HARNESS. `xbandStructure`
//      measured 0.054 GeV a placement against a catalogue 0.30, and
//      `cbandStructure` 0.0497 against 0.12. Both are honest engine behaviour:
//      for a normal-conducting cavity srf.e_acc_max is sqrt(P r_shunt L) / L,
//      and eval-design.mjs's IDEAL_PROVISION supplies rfPowerW = 1e7, which
//      binds far below the 100 and 40 MV/m those structures demand. The
//      harness comment says that number is chosen so "achievable never binds";
//      for the two high-gradient copper structures it does. Flagged rather
//      than worked around — it is the harness's number, not a blueprint's, and
//      it affects every type those two structures are allowlisted to.
//
//   5. THE UNDULATOR BORE IS THE RING'S DOMINANT LOSS. apertureRadius 8 mm,
//      against a beam that leaves a cwCryomodule linac at 13.5 mm sigma.
//      erf(8 / (sqrt(2) x 13.5)) squared is 0.28, so a single straight throws
//      away seven tenths of what reaches it: a two-cell ring tail
//      (septum, fastKicker, FODO, two combined-function bends, two undulators,
//      sextupoles) took a clean 56.4 mA injector down to 3.73 mA. A working
//      lattice has to squeeze under ~3 mm at every straight, which is what a
//      real low-beta insertion section does and what the lattice below was
//      being tuned toward when the current ceiling made the exercise moot.
//      Note also that combined_function_matrix is never rigidity-scaled in
//      linear_optics.py the way quadrupole_matrix is, so a combined-function
//      magnet's focusing does not weaken as the beam stiffens and its
//      quadGradient must be set near the catalogue MINIMUM of 1 T/m at ring
//      energies, not near the default of 20.
//
// ── WHAT THE THREE MACHINES WERE ───────────────────────────────────────────
//
// Kept here so this is a measurement to re-run rather than a design to redo.
// All three share the front end from finding 1 — `source` at 42 kV with a
// single 0.005 T solenoid and NO pre-buncher, capturing on the first
// superconducting module, which measured better than any pillbox or buncher
// arrangement tried. All three then run injection (injectionSeptum +
// fastKicker), a FODO arc of combined-function magnets with sextupoles for
// chromaticity, and undulators on the straights.
//
//   tier 1  Compact 2.5 GeV ring, ALS/SLS-class entry machine.
//           5 x cwCryomodule -> 2.48 GeV measured, 48.18 mA, q 1.00.
//           Two undulator straights.
//   tier 2  3 GeV workhorse, Diamond / NSLS-II / MAX IV class.
//           6 x cwCryomodule -> 2.98 GeV measured, 56.43 mA, q 1.00.
//           Three undulator straights.
//   tier 3  6 GeV flagship, ESRF-EBS / APS-U class.
//           4 x nbSnCryomodule + 2 x cwCryomodule -> 5.76 GeV measured,
//           58.31 mA, q 1.00, loss 0.510. Sits 4% under the 6.0 GeV ceiling
//           deliberately; 5 x nbSnCryomodule measures 5.96 and leaves no room
//           for a phase or gradient the player later touches.
//
// Any ONE of these unblocks the type: a photoinjector source component with a
// current worth a ring, a stored-current model for machineType lightSource, a
// currentMA band written against injected rather than stored current, or a
// synchrotron_light module so the flux the type is scored on exists at all.

export const PHOTON_RING_DESIGNS = [];
