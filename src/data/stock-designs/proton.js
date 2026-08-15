// src/data/stock-designs/proton.js — Isotope & Irradiation, Therapy, Spallation.
//
// The hadron half of the roster. See ../stock-designs.js for the entry shape
// and the authoring rules.
//
// ── EVERY PROTON SOURCE HERE DECLARES particleType EXPLICITLY ──────────────
//
// It is not decoration and it is not redundant with the catalogue. The
// evaluator's payload builder (src/beamline/physics-payload.js) takes a
// design's `params` VERBATIM — it does not merge COMPONENTS[type].params the
// way Game._addPlaceable does. So a blueprint that writes `params: {}` on a
// cyclotron is measured as an ELECTRON beam of the same kinetic energy:
// gameplay.py's extract_source_params only falls back to game_type for
// ionSource/ecrIonSource, and every other proton source in the catalogue
// carries its species in `params.particleType` alone. The first draft of this
// file measured a 30 MeV *electron* line at 1.1 mm spot and 350 uA and looked
// entirely plausible. Writing the species here makes the harness and the game
// agree; see the report note about closing the gap in the harness itself.
//
// ── WHY THESE SIX AND NOT EIGHT ────────────────────────────────────────────
//
// Spallation ships NO blueprint, and the two isotope/therapy ladders are built
// on cyclotron front ends rather than on the RFQ + SRF linac the catalogue's
// low-beta hardware implies. Both follow from measurements, not from taste:
//
//   * NO BUILT-UP PROTON LINAC TRANSPORTS. The rfq is the only structure whose
//     design beta (0.04) can accelerate a sub-MeV proton — every other
//     low-beta cavity (halfWaveResonator, pillboxCavity, spokeCavity) has a
//     transit-time ZERO between the source's beta and its own, so a 40-750 keV
//     beam stalls dead before it reaches them. And the rfq's bore is 6 mm over
//     a 3 m body, an acceptance of ~1.2e-5 m.rad, while the smallest geometric
//     emittance any DC proton source in the catalogue delivers is 6.9e-5
//     (ionSource at 100 kV; cockcroftWalton is 3.0e-4). Best measured
//     transmission over a full solenoid/quad/collimator matching scan: 2 nA
//     out of 50 mA, i.e. 4e-8. No optic fixes an acceptance mismatch.
//
//   * SPALLATION HAS NO OTHER FRONT END. Its palette holds ionSource,
//     ecrIonSource and cockcroftWalton and no cyclotron, so the paragraph above
//     is the whole story: 0.8-3.0 GeV at 1-60 mA is unreachable from anything
//     it is allowed to build. Its highest-gradient allowed structure is the
//     spokeCavity at 10 MeV, and ellipticalSrfCavity/cryomodule — whose
//     DESIGN_BETA of 0.65 is a *proton* number, exactly the SNS/ESS high-beta
//     elliptical — are allowlisted to the electron and photon types only.
//
// So the hadron ladders here are cyclotron + SRF booster: a compound machine
// hands over a beam that is already at 30 or 70 MeV, where beta is 0.25-0.37,
// the spokeCavity's transit-time factor is 0.74-0.99, and the geometric
// emittance finally fits a 32 mm bore. That is also how ARRONAX-class and
// clinical lines are actually extended in the real world.

export const PROTON_DESIGNS = [
  // ── Isotope & Irradiation — 15-70 MeV, 0.1-1.0 mA, 5-50 mm spot ─────────
  //
  // The spot band is the design driver, not the energy: a pencil scores as
  // badly as a blown-up beam, so every one of these ends in a doublet or
  // triplet tuned to hand the target a ~20 mm sigma field rather than the
  // smallest spot it can make.
  {
    id: 'isotope-cyclone30',
    typeId: 'isotopeIrradiation',
    tier: 1,
    name: 'Electronics Test Line (30 MeV)',
    blurb: 'A compact proton machine feeding a raster-scanned test cave. Qualifies satellite electronics and radiation-hard chips for paying customers before the isotope programme comes online.',
    components: [
      { type: 'cyclotron30', params: { particleType: 'proton' } },
      // 0.5 T/m against a 0.24 GeV/c beam: deliberately gentle, and set to
      // SPREAD the beam to ~19 mm rather than to focus it.
      { type: 'quadrupole', params: { gradient: 0.5, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 0.5, polarity: 1 } },
      { type: 'bpm', params: {} },
      { type: 'ict', params: {} },
      { type: 'radiationEffectsStation', params: {} },
    ],
  },
  {
    id: 'isotope-spoke-booster',
    typeId: 'isotopeIrradiation',
    tier: 2,
    name: 'Boosted Isotope Line (47 MeV)',
    blurb: 'Two spoke cavities bolted onto the 30 MeV set, and suddenly the copper-64 and iodine-124 thresholds are open. Half the current, twice the shopping list.',
    components: [
      { type: 'cyclotron30', params: { particleType: 'proton' } },
      // Matching triplet. The cyclotron hands over beta_twiss = 10 m, i.e. a
      // 15 mm sigma, and the spoke bore is 32 mm — close enough that the
      // Gaussian tail is scraped at every one of the cavity's four sub-steps.
      // Squeezing to ~8 mm before the linac is what keeps transmission up.
      { type: 'quadrupole', params: { gradient: 0.6, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 1.2, polarity: 1 } },
      { type: 'quadrupole', params: { gradient: 0.6, polarity: 0 } },
      { type: 'spokeCavity', params: {} },
      { type: 'spokeCavity', params: {} },
      { type: 'bpm', params: {} },
      { type: 'target', params: {} },
    ],
  },
  {
    id: 'isotope-spoke-70',
    typeId: 'isotopeIrradiation',
    tier: 3,
    name: 'ARRONAX-class Line (67 MeV)',
    blurb: 'Four spoke cavities take it to the top of the band: astatine-211 for targeted alpha therapy on one shift, single-event-effect testing for a satellite prime on the next.',
    components: [
      { type: 'cyclotron30', params: { particleType: 'proton' } },
      { type: 'quadrupole', params: { gradient: 0.6, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 1.2, polarity: 1 } },
      { type: 'quadrupole', params: { gradient: 0.6, polarity: 0 } },
      { type: 'spokeCavity', params: {} },
      { type: 'spokeCavity', params: {} },
      { type: 'spokeCavity', params: {} },
      { type: 'spokeCavity', params: {} },
      { type: 'bpm', params: {} },
      { type: 'target', params: {} },
    ],
  },

  // ── Therapy — 70-250 MeV, 1-50 uA ───────────────────────────────────────
  //
  // Read the currents. cyclotron70 extracts 750 uA and cyclotron230 extracts
  // 1 uA; a clinic wants tens of nanoamps at the patient, so on these lines
  // hardware exists to THROW BEAM AWAY, and the losses below (95-98%) are the
  // machine working correctly rather than a design defect.
  {
    id: 'therapy-ocular70',
    typeId: 'therapy',
    tier: 1,
    name: 'Ocular Beamline (70 MeV)',
    blurb: 'Clatterbridge in a box. 70 MeV protons treat ocular melanoma and nothing else, and ninety-six percent of the beam ends its life in a brass collimator.',
    components: [
      { type: 'cyclotron70', params: { particleType: 'proton' } },
      // Two expand-and-scrape stages. One stage needs a knife-edge gradient to
      // take 750 uA down to tens; splitting it across two collimators is what
      // makes the setting a tune rather than a cliff.
      { type: 'quadrupole', params: { gradient: 4.7, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 4.7, polarity: 1 } },
      { type: 'collimator', params: {} },
      { type: 'quadrupole', params: { gradient: 4.7, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 4.7, polarity: 1 } },
      { type: 'collimator', params: {} },
      { type: 'ict', params: {} },
      { type: 'bpm', params: {} },
      { type: 'beamStop', params: {} },
    ],
  },
  {
    id: 'therapy-spoke145',
    typeId: 'therapy',
    tier: 2,
    name: 'Shallow-Field Gantry (145 MeV)',
    blurb: 'Eight spoke cavities past the cyclotron and the range reaches a head and neck rather than an eye. Energy is set by how much linac you switch on, so there is no degrader and no activated graphite to dispose of.',
    components: [
      { type: 'cyclotron70', params: { particleType: 'proton' } },
      // FODO through the booster, gradients stepped with the momentum: the
      // beam stiffens from 0.37 to 0.54 GeV/c across these eight cavities and
      // a fixed gradient would be over-focusing at the start of the run and
      // under-focusing at the end.
      { type: 'spokeCavity', params: {} },
      { type: 'spokeCavity', params: {} },
      { type: 'quadrupole', params: { gradient: 1.868, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 1.868, polarity: 1 } },
      { type: 'spokeCavity', params: {} },
      { type: 'spokeCavity', params: {} },
      { type: 'quadrupole', params: { gradient: 2.066, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 2.066, polarity: 1 } },
      { type: 'spokeCavity', params: {} },
      { type: 'spokeCavity', params: {} },
      { type: 'quadrupole', params: { gradient: 2.243, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 2.243, polarity: 1 } },
      { type: 'spokeCavity', params: {} },
      { type: 'spokeCavity', params: {} },
      { type: 'quadrupole', params: { gradient: 2.403, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 2.403, polarity: 1 } },
      // Intensity-defining stage. The booster transports ~250 uA and the
      // clinic is allowed 50; this doublet and collimator are the difference.
      { type: 'quadrupole', params: { gradient: 5, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 5, polarity: 1 } },
      { type: 'collimator', params: {} },
      { type: 'ict', params: {} },
      { type: 'bpm', params: {} },
      { type: 'beamStop', params: {} },
    ],
  },
  {
    id: 'therapy-spoke230',
    typeId: 'therapy',
    tier: 3,
    name: 'Full-Depth Treatment Line (232 MeV)',
    blurb: 'Nineteen cavities and enough range for a prostate. The reference machine of the type: every fraction it delivers is money, every hour it is down is reputation.',
    components: [
      { type: 'cyclotron70', params: { particleType: 'proton' } },
      { type: 'spokeCavity', params: {} },
      { type: 'spokeCavity', params: {} },
      { type: 'quadrupole', params: { gradient: 1.681, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 1.681, polarity: 1 } },
      { type: 'spokeCavity', params: {} },
      { type: 'spokeCavity', params: {} },
      { type: 'quadrupole', params: { gradient: 1.859, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 1.859, polarity: 1 } },
      { type: 'spokeCavity', params: {} },
      { type: 'spokeCavity', params: {} },
      { type: 'quadrupole', params: { gradient: 2.019, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 2.019, polarity: 1 } },
      { type: 'spokeCavity', params: {} },
      { type: 'spokeCavity', params: {} },
      { type: 'quadrupole', params: { gradient: 2.163, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 2.163, polarity: 1 } },
      { type: 'spokeCavity', params: {} },
      { type: 'spokeCavity', params: {} },
      { type: 'quadrupole', params: { gradient: 2.296, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 2.296, polarity: 1 } },
      { type: 'spokeCavity', params: {} },
      { type: 'spokeCavity', params: {} },
      { type: 'quadrupole', params: { gradient: 2.419, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 2.419, polarity: 1 } },
      { type: 'spokeCavity', params: {} },
      { type: 'spokeCavity', params: {} },
      { type: 'quadrupole', params: { gradient: 2.535, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 2.535, polarity: 1 } },
      { type: 'spokeCavity', params: {} },
      { type: 'spokeCavity', params: {} },
      { type: 'quadrupole', params: { gradient: 2.644, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 2.644, polarity: 1 } },
      { type: 'spokeCavity', params: {} },
      { type: 'spokeCavity', params: {} },
      { type: 'quadrupole', params: { gradient: 2.749, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 2.749, polarity: 1 } },
      { type: 'spokeCavity', params: {} },
      { type: 'ict', params: {} },
      { type: 'bpm', params: {} },
      { type: 'beamStop', params: {} },
    ],
  },

  // ── Spallation Neutron Source — NO BLUEPRINT ────────────────────────────
  //
  // Not an oversight and not "yet to be authored": 0.8-3.0 GeV at 1-60 mA is
  // unreachable from this type's palette, for the two measured reasons in the
  // file header. Closing it needs a catalogue change, not a cleverer lattice —
  // either a proton-class front end whose emittance fits an RFQ bore, or
  // ellipticalSrfCavity/cryomodule (DESIGN_BETA 0.65, which IS the SNS/ESS
  // high-beta proton cavity) added to spallation's `beamlineTypes`. Shipping a
  // blueprint that dies in its first three metres would be worse than shipping
  // none, because the picker would advertise a megawatt it cannot make.
];
