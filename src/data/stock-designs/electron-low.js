// src/data/stock-designs/electron-low.js — Test Stand and E-beam Processing.
//
// The two tier-1 types: ungated, buildable on tick 0, and between them the
// game's tutorial for what a linac front end is. See ../stock-designs.js for
// the entry shape and the authoring rules.
//
// Every number in the comments below was MEASURED with
// `node scripts/eval-design.mjs testStand ebeamProcessing`, not derived. Four
// things about this engine drove almost every choice here, and re-deriving
// them costs an hour each:
//
//   1. RF CAPTURE SETS THE CURRENT, and nothing downstream can get it back.
//      The FIRST RF element a DC beam meets keeps a fixed fraction of it
//      (CAPTURE_EFFICIENCY in beam_physics/modules/rf_acceleration.py:
//      pillbox 0.50, buncher 0.65, sband/rfCavity 0.45) and throws the rest
//      away. The thermionic gun is a constant-POWER source — 5 kW, so
//      I = 5000/V mA — so the delivered current is set at the moment you pick
//      the extraction voltage, and the only way to sell more milliamps is to
//      run the gun at a lower voltage. Every design here is tuned to reach
//      `loss = capture` exactly, i.e. to scrape nothing at all.
//
//   2. QUADRUPOLES ARE UNUSABLE BELOW ~1 MeV. Focusing is k = 0.2998 g / p,
//      and at a 40 keV gun p is 2e-4 GeV/c, so even the catalogue MINIMUM
//      0.01 T/m gives sqrt(k)L ≈ 12 rad and the beam is measured at 1.2 m
//      across before it reaches the first cavity. A quad ahead of the first
//      accelerating structure is always a dead beam. Solenoids are the only
//      low-energy optics that work, at 0.004–0.007 T (k = 0.2998 B / 2p, a
//      quarter wave over the component's own 1 m), and even they are
//      oscillatory: 0.007 T transmits everything and 0.009 T loses 90%.
//      At 39 MeV the workable quad gradient is 0.01–0.05 T/m, still a
//      hundredth of the catalogue default.
//
//   3. TRANSIT TIME IS WHY THERE IS A PILLBOX IN FRONT OF EVERYTHING. Each
//      cavity has a design beta (pillbox 0.1, sband 0.95, industrialLinac's
//      unlisted default 0.9) and a sinc-shaped penalty away from it. A gun
//      beam at beta 0.4 gets ~60% of an industrial linac's nameplate — one
//      pillbox cavity ahead of it lifts the beam to beta 0.85 and recovers
//      the full 10 MeV for $200k. That single component is the difference
//      between the tier-1 and tier-2 processing lines below.
//
//   4. TWO CAVITIES DO NOT DO WHAT THEIR CATALOGUE TEXT SAYS. `rfCavity`
//      carries PARAM_DEFS with a `voltage` knob, so computeStats overwrites
//      its catalogue 0.045 GeV with V x 0.85 / 1000 — at the 2.0 MV maximum
//      that is 1.7 MeV per module, not the 45 MeV the description advertises.
//      `industrialLinac` and `sbandStructure` have NO PARAM_DEFS entry, so
//      their catalogue `gradient` param is inert and their gain is fixed at
//      10 and 51 MeV. Both are noted as findings; the blueprints are built
//      around the behaviour, not the prose.

export const ELECTRON_LOW_TIER_DESIGNS = [
  // ── Test Stand ───────────────────────────────────────────────────────
  //
  // Band E 5–50 MeV, I 1–100 mA, scored on beam power. The ladder is
  // energy first (5.5 -> 37 MeV) and then current (10 -> 16 -> 56 mA), which
  // is the honest shape of the type: one S-band structure already lands
  // mid-band, so the only room left above it is milliamps.
  {
    id: 'testStand-bench',
    typeId: 'testStand',
    tier: 1,
    name: 'Gun Test Bench',
    blurb: 'A gun, four copper cavities and a cup to catch it in. The machine you learn on — enough beam to commission a diagnostic, not enough to destroy one.',
    // MEASURED 5.53 MeV, 10.00 mA, q 1.00, loss 0.500 (capture only).
    // The gun runs at its 250 kV end stop on purpose: 20 mA is all this
    // bench needs, and the stiffer beam transports the ten metres of copper
    // without a single magnet on the line. The pillbox is here for transit
    // time, not energy — it lifts beta 0.74 -> 0.87 so the three beta = 1
    // cavities behind it work at full gradient, and it captures at 0.50
    // instead of the 0.45 they would.
    components: [
      { type: 'source', params: { extractionVoltage: 250, cathodeTemperature: 1200 } },
      { type: 'pillboxCavity', params: { voltage: 2.0, rfPhase: 0 } },
      { type: 'rfCavity', params: { voltage: 2.0, rfPhase: 0 } },
      { type: 'rfCavity', params: { voltage: 2.0, rfPhase: 0 } },
      { type: 'rfCavity', params: { voltage: 2.0, rfPhase: 0 } },
      { type: 'bpm', params: {} },
      { type: 'faradayCup', params: {} },
    ],
  },
  {
    id: 'testStand-sband',
    typeId: 'testStand',
    tier: 2,
    name: 'S-band Injector Test Stand',
    blurb: 'A real injector: capture section, an S-band structure and a matched doublet. This is the front end every bigger machine here starts with.',
    // MEASURED 37.1 MeV, 16.30 mA, q 1.00, loss 0.71.
    components: [
      { type: 'source', params: { extractionVoltage: 90, cathodeTemperature: 1400 } },
      { type: 'solenoid', params: { fieldStrength: 0.006 } },
      { type: 'buncher', params: { voltage: 0.2, rfPhase: -90 } },
      { type: 'pillboxCavity', params: { voltage: 0.5, rfPhase: 0 } },
      { type: 'solenoid', params: { fieldStrength: 0.004 } },
      { type: 'sbandStructure', params: {} },
      { type: 'quadrupole', params: { gradient: 0.05, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 0.05, polarity: 1 } },
      { type: 'bpm', params: {} },
      { type: 'beamStop', params: {} },
    ],
  },
  {
    id: 'testStand-highpower',
    typeId: 'testStand',
    tier: 3,
    name: 'High-Power Beam Test Stand',
    blurb: 'Two megawatts onto a dump, with enough diagnostics to prove where every watt of it went. Rented by the week to people who need real current and can be talked out of needing real energy.',
    // MEASURED 39.04 MeV, 55.55 mA, q 1.00, loss 0.500 (capture only) —
    // 2.17 MW, three and a half times the tier-2 stand.
    //
    // Same S-band structure as tier 2; the current comes from running the
    // gun at 45 kV, where the constant-power source makes 111 mA instead of
    // 56, and from deleting the buncher. The buncher's 0.65 capture looks
    // better than the pillbox's 0.50 on paper and measures far worse in
    // practice: it stamps a 200 MHz bunch structure onto a beam that then
    // has to survive to a 2856 MHz structure, and the measured transmission
    // fell from 100% to 47%. 2.0 MV on the pillbox instead of 0.5 also
    // matters — it is what carries beta past 0.85 before the S-band bore.
    //
    // Two doublets, both at 0.01–0.02 T/m. That is not a typo and not
    // timidity: at 39 MeV, p = 0.039 GeV/c, so 0.02 T/m already gives
    // sqrt(k)L = 0.39 rad. The catalogue default of 20 T/m is a GeV number.
    components: [
      { type: 'source', params: { extractionVoltage: 45, cathodeTemperature: 1600 } },
      { type: 'pillboxCavity', params: { voltage: 2.0, rfPhase: 0 } },
      { type: 'solenoid', params: { fieldStrength: 0.005 } },
      { type: 'sbandStructure', params: {} },
      { type: 'quadrupole', params: { gradient: 0.01, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 0.01, polarity: 1 } },
      { type: 'screen', params: {} },
      { type: 'quadrupole', params: { gradient: 0.02, polarity: 1 } },
      { type: 'quadrupole', params: { gradient: 0.02, polarity: 0 } },
      { type: 'wireScanner', params: {} },
      { type: 'ict', params: {} },
      { type: 'bpm', params: {} },
      { type: 'beamStop', params: {} },
    ],
  },

  // ── E-beam Processing Line ───────────────────────────────────────────
  //
  // Band E 3–12 MeV, I 20–100 mA, scored on beam power. The 12 MeV ceiling
  // is a regulator's line, not an economic one — above ~10 MeV the product
  // being irradiated activates — so NONE of these three is allowed to be
  // "the same but bigger". The ladder is energy to the 10 MeV nameplate and
  // then current at it, and a second industrial linac (measured 17.9 MeV) is
  // not an upgrade, it is a machine nobody may switch on.
  //
  // The 20 mA floor is the binding constraint on all three. With the first
  // RF element capturing 0.50, the gun has to make 40 mA before anything
  // else happens, and I = 5000/V puts a hard ceiling of 125 kV on the
  // extraction voltage of every design in this type.
  {
    id: 'ebeam-crosslinker',
    typeId: 'ebeamProcessing',
    tier: 1,
    name: 'Crosslinking Skid (6 MeV)',
    blurb: 'One linac, one current monitor and a wall of concrete. Cures cable insulation and tyre rubber by the reel, and cost less than the shielding around it.',
    // MEASURED 6.27 MeV, 31.25 mA, q 1.00, loss 0.500 (capture only).
    // 196 kW.
    //
    // Deliberately has no pre-accelerator: the industrial linac IS the
    // machine, so it eats the transit-time penalty of a beta 0.5 beam and
    // delivers 6.3 of its nameplate 10 MeV. That is not a defect to fix at
    // this tier — it is why the tier-2 line's $200k pillbox is worth buying.
    components: [
      { type: 'source', params: { extractionVoltage: 80, cathodeTemperature: 1600 } },
      { type: 'industrialLinac', params: {} },
      { type: 'ict', params: {} },
      { type: 'beamStop', params: {} },
    ],
  },
  {
    id: 'ebeam-sterilisation',
    typeId: 'ebeamProcessing',
    tier: 2,
    name: 'Sterilisation Line (10 MeV)',
    blurb: 'Pallets in one end, sterile pallets out the other. Paid by the kilogray, and it never has to be brilliant.',
    // MEASURED 10.16 MeV, 31.25 mA, q 1.00, loss 0.500 (capture only).
    // 318 kW — the Rhodotron TT300 nameplate, three times over.
    //
    // Identical to the crosslinking skid plus one pillbox cavity. It adds
    // 0.4 MeV of its own and buys back 3.9 MeV from the industrial linac by
    // handing it a beta 0.85 beam instead of a beta 0.5 one. Sits 15% under
    // the regulatory ceiling, which is where a production line wants to be.
    components: [
      { type: 'source', params: { extractionVoltage: 80, cathodeTemperature: 1600 } },
      { type: 'pillboxCavity', params: { voltage: 2.0, rfPhase: 0 } },
      { type: 'industrialLinac', params: {} },
      { type: 'ict', params: {} },
      { type: 'beamStop', params: {} },
    ],
  },
  {
    id: 'ebeam-highpower',
    typeId: 'ebeamProcessing',
    tier: 3,
    name: 'High-Power Sterilisation Line (10 MeV)',
    blurb: 'The same ten MeV and twice the milliamps: the gun runs hot, a solenoid keeps it all inside the bore, and the pallets go through the room at a jog.',
    // MEASURED 10.20 MeV, 62.49 mA, q 1.00, loss 0.500 (capture only).
    // 637 kW, double the tier-2 line at the same legal energy.
    //
    // The only lever left under a regulatory ceiling is current, so the gun
    // drops to 40 kV where the constant-power source makes 125 mA. 40 kV is
    // the floor of the usable range and it is set by beam QUALITY, not by
    // transmission: at 35 kV the measured q falls to 0.77 and at 25 kV to
    // 0.33, while the current keeps climbing. 40 kV is the last operating
    // point that still delivers q = 1.00.
    //
    // Two solenoids, and they do different jobs. The 0.005 T one matches the
    // 125 mA beam through the linac's 19 mm bore — without it the peak
    // envelope is 22 mm and a third of the beam is on the wall. The 0.05 T
    // one is downstream, where the beam is stiff, and puts a 4 mm spot on
    // the product. Both are oscillatory: 0.009 T on the first one loses 90%
    // of the beam, so treat these as tuned values rather than minimums.
    components: [
      { type: 'source', params: { extractionVoltage: 40, cathodeTemperature: 1600 } },
      { type: 'pillboxCavity', params: { voltage: 2.0, rfPhase: 0 } },
      { type: 'solenoid', params: { fieldStrength: 0.005 } },
      { type: 'industrialLinac', params: {} },
      { type: 'solenoid', params: { fieldStrength: 0.05 } },
      { type: 'ict', params: {} },
      { type: 'beamStop', params: {} },
    ],
  },
];
