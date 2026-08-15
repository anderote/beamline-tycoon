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
// ── THE FRONT-END HANDOFF IS AN EXPLICIT MACHINE STEP ─────────────────────
//
// A bare DC ion source cannot be matched through the catalogue RFQ: its phase
// space is wider than the 6 mm bore accepts. The spallation ladder therefore
// starts with protonLinacFrontEnd, a compound ion-source/RFQ/low-beta-linac
// sector delivering 180 MeV. From there the existing 650 MHz medium-beta and
// 805 MHz high-beta cryomodules reproduce the PIP-II/SNS/ESS progression. The
// abstraction is visible and priced; it does not pretend the hard first 180
// MeV disappeared.

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

  // ── Spallation Neutron Source — 0.8-3 GeV, 1-60 mA ──────────────────────
  {
    id: 'spallation-compact-800',
    typeId: 'spallation',
    tier: 1,
    name: 'Compact Neutron Source (0.8 GeV)',
    blurb: 'A commissioned 180 MeV front end and five medium-beta modules: the entry neutron source uses exactly the hardware its family research unlocks.',
    components: [
      { type: 'protonLinacFrontEnd', params: { particleType: 'proton' } },
      { type: 'srf650Cryomodule', params: {} },
      { type: 'srf650Cryomodule', params: {} },
      { type: 'srf650Cryomodule', params: {} },
      { type: 'quadrupole', params: { gradient: 1.2, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 1.2, polarity: 1 } },
      { type: 'srf650Cryomodule', params: {} },
      { type: 'srf650Cryomodule', params: {} },
      { type: 'bpm', params: {} },
      { type: 'ict', params: {} },
      { type: 'spallationNeutronTarget', params: {} },
    ],
  },
  {
    id: 'spallation-sns-1600',
    typeId: 'spallation',
    tier: 2,
    name: 'SNS-class Source (1.6 GeV)',
    blurb: 'Three high-beta sectors lift the same proven injector into a general-purpose pulsed neutron facility with room for a serious instrument programme.',
    components: [
      { type: 'protonLinacFrontEnd', params: { particleType: 'proton' } },
      { type: 'srf650Cryomodule', params: {} },
      { type: 'srf650Cryomodule', params: {} },
      { type: 'quadrupole', params: { gradient: 1.4, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 1.4, polarity: 1 } },
      { type: 'srf805Cryomodule', params: {} },
      { type: 'srf805Cryomodule', params: {} },
      { type: 'quadrupole', params: { gradient: 2.0, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 2.0, polarity: 1 } },
      { type: 'srf805Cryomodule', params: {} },
      { type: 'bpm', params: {} },
      { type: 'ict', params: {} },
      { type: 'wireScanner', params: {} },
      { type: 'spallationNeutronTarget', params: {} },
    ],
  },
  {
    id: 'spallation-ess-2800',
    typeId: 'spallation',
    tier: 3,
    name: 'Flagship Neutron Source (2.8 GeV)',
    blurb: 'Six high-beta sectors and stepped FODO control push the reference linac near the top of its band: expensive, power-hungry and booked years ahead.',
    components: [
      { type: 'protonLinacFrontEnd', params: { particleType: 'proton' } },
      { type: 'srf650Cryomodule', params: {} },
      { type: 'srf650Cryomodule', params: {} },
      { type: 'quadrupole', params: { gradient: 1.4, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 1.4, polarity: 1 } },
      { type: 'srf805Cryomodule', params: {} },
      { type: 'srf805Cryomodule', params: {} },
      { type: 'quadrupole', params: { gradient: 2.0, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 2.0, polarity: 1 } },
      { type: 'srf805Cryomodule', params: {} },
      { type: 'srf805Cryomodule', params: {} },
      { type: 'quadrupole', params: { gradient: 2.8, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 2.8, polarity: 1 } },
      { type: 'srf805Cryomodule', params: {} },
      { type: 'srf805Cryomodule', params: {} },
      { type: 'bpm', params: {} },
      { type: 'ict', params: {} },
      { type: 'wireScanner', params: {} },
      { type: 'scanningMagnet', params: {} },
      { type: 'spallationNeutronTarget', params: {} },
    ],
  },
];
