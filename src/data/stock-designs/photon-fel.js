// src/data/stock-designs/photon-fel.js — XFEL (hard X-ray) and EUV FEL.
//
// Both files' machines lase; almost nothing else about them agrees. The XFEL
// wants 6-17.5 GeV at microamps in burst mode; the EUV drive line wants
// 0.8-1.2 GeV at 5-15 mA, continuously, forever. They are deliberately
// authored together so the two rosters cannot drift into looking alike — if a
// blueprint here would work for both types, it is wrong for one of them.
//
// See ../stock-designs.js for the entry shape and the authoring rules. Every
// number quoted below was MEASURED with `node scripts/eval-design.mjs xfel`
// and `... euvFel`, not derived. Five findings shaped every design here.
//
//   1. THE THERMIONIC GUN CANNOT BUILD AN XFEL, and this is the single fact
//      that decides the whole roster. `source` is a constant-POWER cathode —
//      I = 5 kW / V, so 20 mA at its 250 kV end stop — and the best capture
//      any structure on xfel's palette offers is xbandStructure's 0.40.
//      MEASURED floor for a gun-driven XFEL: 8.00 mA, which is 800x the
//      band's 10 uA CEILING. Getting an XFEL's current DOWN is a harder
//      design problem than getting its energy up, and there is exactly one
//      component in the catalogue that solves it: `lwfaStation`, whose
//      100 pC at 10 kHz is 1.00 uA — sitting, by construction, in the middle
//      of the 0.5-10 uA window. All three XFELs below are plasma-injected
//      because nothing else in the game can be.
//
//   2. THE 0.5 uA FLOOR IS DECIDED BY THE FIRST RF ELEMENT, and a cryomodule
//      misses it. Capture is applied once, at the first RF element the beam
//      meets, and every SRF rung captures 0.50. MEASURED: lwfaStation into a
//      bare Nb3Sn string delivers 0.499969 uA — under the 0.5 uA floor by
//      31 nA, i.e. by 0.006%, and it fails. One `buncher` ahead of the linac
//      captures 0.65 instead and lands 0.650 uA with 30% of margin. That
//      $150k cavity is not decoration: it is the difference between a
//      shipping blueprint and one the evaluator rejects.
//
//   3. THE EUV LADDER HAS ONE LEVER AND IT IS THE GUN VOLTAGE. With capture
//      pinned at 0.50 and the gun's 250 kV end stop giving 20 mA, the lowest
//      current this type can deliver is 10.00 mA — already the middle of its
//      own 5-15 mA band. The 5-10 mA half of that band is UNREACHABLE with
//      the hardware that exists; the reachable segment is 10.0 to 15.0 mA,
//      and the only way along it is to turn the gun DOWN. Reported as a
//      finding rather than papered over: see the tier-1 note below.
//
//   4. THE BUNCHER IS THE WRONG UPGRADE FOR THE EUV LINE, and it measures so.
//      A 220 kV gun behind a 162.5 MHz buncher delivers 14.77 mA — slightly
//      more than the 170 kV gun's 14.71 — but its normalised emittance
//      measures 7.37e-6 against 3.15e-6, and the diffraction limit at 13.5 nm
//      is eps_n = 2.1e-6. Paying three and a half times the diffraction limit
//      for 0.07 mA is not a tier-3 machine. This is the same trap
//      electron-low.js documents on the test stand, arriving for a different
//      reason: there the buncher cost transmission, here it costs phase space.
//
//   5. NOTHING HERE SATURATES, AND NOTHING CAN. `felSaturated` is false for
//      all six. FELGainModule wants the whole exponential gain inside ONE
//      undulator element — L_sat = 20 L_gain against a 5 m element, i.e. a
//      25 cm gain length, where real hard X-ray FELs run 3-5 m over a
//      hundred-metre string. At 0.65 uA average the peak current is
//      microamps and the Pierce parameter is nowhere near it either. This is
//      an ENGINE finding, not a blueprint failure — no lattice buildable from
//      this catalogue lases — and it matters because xfel's `felBrilliance`
//      FoM is multiplied by saturation squared. Flagged for whoever
//      implements the FoM; the blueprints are built to be correct machines in
//      every respect the evaluator can currently see.

export const PHOTON_FEL_DESIGNS = [
  // ── XFEL (hard X-ray) ────────────────────────────────────────────────
  //
  // Band E 6-17.5 GeV, I 0.5-10 uA, dutyMin 0 — burst mode, microamps,
  // maximum energy, and emittance preservation over hundreds of metres.
  // Every one of these is a plasma station handing a GeV to a Nb3Sn string
  // (finding 1), and the ladder is pure energy: 6.3 -> 8.2 -> 16.5 GeV,
  // which at fixed undulator hardware is 7.5 -> 12.7 -> 20.3 keV of photon.
  // The customer buys the photon energy, not the beam energy, and that is
  // what the tier names say.
  //
  // The current is IDENTICAL across all three at 0.650 uA, and that is the
  // type's signature: an XFEL's average current is set by its injector and
  // nothing downstream ever adds to it. Compare the EUV roster below, where
  // the current is the only thing that changes.
  {
    id: 'xfel-plasma-injector',
    typeId: 'xfel',
    tier: 1,
    name: 'Plasma-Injected XFEL (7.5 keV)',
    blurb: 'A petawatt laser does the first gigavolt in three centimetres so you only have to buy the other five. Serial crystallography at 7.5 keV, and the shot-to-shot jitter is somebody else\'s problem.',
    // MEASURED 6.299 GeV, 0.650 uA, q 1.00, loss 0.350 (capture only),
    // eps_n 1.06e-5 m-rad, final spot 0.12 x 0.52 mm, peak envelope 0.56 mm.
    // First harmonic at a 10 mm undulator gap (K = 1.165): 0.166 nm, 7.48 keV
    // — the protein window, and SwissFEL Aramis' home ground.
    //
    // 4 x 1.2 GeV of Nb3Sn plus ONE CW module, not a fifth Nb3Sn sector. The
    // fifth sector lands at 7.00 GeV and buys nothing: the undulator
    // resonance goes as 1/E^2, so the extra 700 MeV moves the photon off the
    // 7.5 keV line the day-one users asked for. The trim module is how you
    // hit a photon energy rather than a beam energy.
    //
    // NO quadrupole ahead of the undulator hall. The plasma beam enters at
    // 1 GeV and leaves the linac at 6.3, and k = 0.2998 g / p means one
    // magnet cannot be right at both; the beam is small (peak 0.56 mm in a
    // 56 mm bore) and drift-and-damp transport measures better than any
    // fixed gradient. The 11 T/m doublets start only where the energy has
    // stopped changing — k = 0.157, sqrt(k)L = 0.40 rad per cell, which is
    // the phase advance every XFEL here is matched to.
    components: [
      { type: 'lwfaStation', params: {} },
      { type: 'buncher', params: { voltage: 0.1, rfPhase: 0 } },
      { type: 'nbSnCryomodule', params: { rfPhase: 0 } },
      { type: 'nbSnCryomodule', params: { rfPhase: 0 } },
      { type: 'nbSnCryomodule', params: { rfPhase: 0 } },
      { type: 'nbSnCryomodule', params: { rfPhase: 0 } },
      { type: 'cwCryomodule', params: { rfPhase: 0 } },
      { type: 'chicane', params: { r56: -50 } },
      { type: 'quadrupole', params: { gradient: 11, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 11, polarity: 1 } },
      { type: 'undulator', params: { gap: 10 } },
      { type: 'quadrupole', params: { gradient: 11, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 11, polarity: 1 } },
      { type: 'undulator', params: { gap: 10 } },
      { type: 'bpm', params: {} },
      { type: 'beamStop', params: {} },
    ],
  },
  {
    id: 'xfel-hard-xray',
    typeId: 'xfel',
    tier: 2,
    name: 'Hard X-ray FEL (12.7 keV)',
    blurb: 'Eight gigavolts and two-stage compression, sold by the pulse to people who need to watch an iron atom move. The machine LCLS-II-HE was built to be, at the energy it was built to reach.',
    // MEASURED 8.198 GeV, 0.650 uA, q 1.00, loss 0.350 (capture only),
    // eps_n 1.06e-5 m-rad, final spot 0.24 x 0.05 mm, peak envelope 0.40 mm.
    // 12.68 keV at a 10 mm gap — LCLS-II-HE quotes 12.8 keV at 8 GeV, and
    // this lattice reproduces it to under a percent without being asked to.
    //
    // TWO chicanes, at 3.4 GeV and at 8.2, which is the LCLS BC1/BC2
    // arrangement and not decoration: r56 -30 mm early where the beam is
    // soft and -50 mm late where it is stiff. Compressing everything in one
    // place at 8 GeV asks a chicane to do at high rigidity what it is cheap
    // to do at low.
    //
    // The 6 T/m doublet at 3.4 GeV and the 14 T/m doublets at 8.2 hold the
    // SAME k = 0.154 and therefore the same 0.39 rad of phase advance. The
    // gradient more than doubles across the machine because the momentum
    // does; that is the entire content of a graded FODO, and it is why a
    // blueprint may never leave a quadrupole on its catalogue default.
    components: [
      { type: 'lwfaStation', params: {} },
      { type: 'buncher', params: { voltage: 0.1, rfPhase: 0 } },
      { type: 'nbSnCryomodule', params: { rfPhase: 0 } },
      { type: 'nbSnCryomodule', params: { rfPhase: 0 } },
      { type: 'quadrupole', params: { gradient: 6, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 6, polarity: 1 } },
      { type: 'chicane', params: { r56: -30 } },
      { type: 'nbSnCryomodule', params: { rfPhase: 0 } },
      { type: 'nbSnCryomodule', params: { rfPhase: 0 } },
      { type: 'nbSnCryomodule', params: { rfPhase: 0 } },
      { type: 'nbSnCryomodule', params: { rfPhase: 0 } },
      { type: 'chicane', params: { r56: -50 } },
      { type: 'quadrupole', params: { gradient: 14, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 14, polarity: 1 } },
      { type: 'undulator', params: { gap: 10 } },
      { type: 'quadrupole', params: { gradient: 14, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 14, polarity: 1 } },
      { type: 'undulator', params: { gap: 10 } },
      { type: 'quadrupole', params: { gradient: 14, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 14, polarity: 1 } },
      { type: 'undulator', params: { gap: 10 } },
      { type: 'quadrupole', params: { gradient: 14, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 14, polarity: 1 } },
      { type: 'undulator', params: { gap: 10 } },
      { type: 'screen', params: {} },
      { type: 'bpm', params: {} },
      { type: 'beamStop', params: {} },
    ],
  },
  {
    id: 'xfel-flagship',
    typeId: 'xfel',
    tier: 3,
    name: 'Flagship XFEL (20 keV)',
    blurb: 'Thirteen Nb3Sn sectors, a hundred and sixty metres of cold linac and an undulator hall you can see from the gate. European XFEL class, and the only machine in the roster that sells twenty-keV photons.',
    // MEASURED 16.545 GeV, 0.650 uA, q 1.00, loss 0.350 (capture only),
    // eps_n 1.06e-5 m-rad, final spot 0.35 x 0.11 mm, peak envelope 0.40 mm.
    // 20.32 keV at the undulator's 5 mm gap stop (K = 2.555).
    //
    // THE UNDULATOR GAP IS CLOSED ALL THE WAY, and that is this machine's
    // real design constraint rather than a setting. 16.5 GeV is so much
    // energy that at the tier-1 and tier-2 gap of 10 mm the first harmonic
    // lands at 52 keV, past where any beamline optic will take it; winding
    // the gap down to its 5 mm stop is the only lever left and it only gets
    // back to 20 keV. Buying the top of the band means buying the hard end
    // of the photon market — high pressure, heavy elements, nuclear resonant
    // scattering — and NOT being able to serve tier 1's customers. Fourteen
    // sectors would measure 17.8 GeV and leave the band entirely.
    //
    // The FODO is graded in four steps: 6 T/m at 3.4 GeV, 12 at 7.0, 20 at
    // 10.6, 29 at 16.5. Every one of those holds k within 0.155-0.170, i.e.
    // 0.39-0.41 rad of phase advance per cell, and the peak envelope over
    // 160 m of linac measures 0.40 mm. Ungraded — one 29 T/m setting
    // throughout — the same machine measures 1.02 mm, which is still safe
    // but 2.5x dimmer into the undulator. Four extra magnets buy that back.
    components: [
      { type: 'lwfaStation', params: {} },
      { type: 'buncher', params: { voltage: 0.1, rfPhase: 0 } },
      { type: 'nbSnCryomodule', params: { rfPhase: 0 } },
      { type: 'nbSnCryomodule', params: { rfPhase: 0 } },
      { type: 'quadrupole', params: { gradient: 6, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 6, polarity: 1 } },
      { type: 'chicane', params: { r56: -30 } },
      { type: 'nbSnCryomodule', params: { rfPhase: 0 } },
      { type: 'nbSnCryomodule', params: { rfPhase: 0 } },
      { type: 'nbSnCryomodule', params: { rfPhase: 0 } },
      { type: 'quadrupole', params: { gradient: 12, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 12, polarity: 1 } },
      { type: 'nbSnCryomodule', params: { rfPhase: 0 } },
      { type: 'nbSnCryomodule', params: { rfPhase: 0 } },
      { type: 'nbSnCryomodule', params: { rfPhase: 0 } },
      { type: 'quadrupole', params: { gradient: 20, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 20, polarity: 1 } },
      { type: 'nbSnCryomodule', params: { rfPhase: 0 } },
      { type: 'nbSnCryomodule', params: { rfPhase: 0 } },
      { type: 'nbSnCryomodule', params: { rfPhase: 0 } },
      { type: 'nbSnCryomodule', params: { rfPhase: 0 } },
      { type: 'nbSnCryomodule', params: { rfPhase: 0 } },
      { type: 'chicane', params: { r56: -50 } },
      { type: 'quadrupole', params: { gradient: 29, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 29, polarity: 1 } },
      { type: 'undulator', params: { gap: 5 } },
      { type: 'quadrupole', params: { gradient: 29, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 29, polarity: 1 } },
      { type: 'undulator', params: { gap: 5 } },
      { type: 'quadrupole', params: { gradient: 29, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 29, polarity: 1 } },
      { type: 'undulator', params: { gap: 5 } },
      { type: 'quadrupole', params: { gradient: 29, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 29, polarity: 1 } },
      { type: 'undulator', params: { gap: 5 } },
      { type: 'quadrupole', params: { gradient: 29, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 29, polarity: 1 } },
      { type: 'undulator', params: { gap: 5 } },
      { type: 'quadrupole', params: { gradient: 29, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 29, polarity: 1 } },
      { type: 'undulator', params: { gap: 5 } },
      { type: 'wireScanner', params: {} },
      { type: 'ict', params: {} },
      { type: 'bpm', params: {} },
      { type: 'beamStop', params: {} },
    ],
  },

  // ── EUV FEL Drive Line ───────────────────────────────────────────────
  //
  // Band E 0.8-1.2 GeV, I 5-15 mA, dutyMin 1.0. THE INVERSION OF EVERYTHING
  // ABOVE, and the roster has to read that way at a glance:
  //
  //   XFEL      1.00 uA plasma injector · 4-13 Nb3Sn sectors · 6.3-16.5 GeV
  //             · burst mode · ENERGY is the ladder · beam dumped
  //   EUV FEL   10-15 mA thermionic gun · 2 CW sectors, always 2 · ~0.99 GeV
  //             on all three · continuous · CURRENT is the ladder · beam
  //             recovered
  //
  // All three sit within 5 MeV of each other, and that is not laziness — it
  // is the contract. The undulator resonance sets the wavelength from the
  // beam energy, the fab's Mo/Si multilayer mirrors reflect 13.5 nm through
  // a ~2% window, and a machine built to 1.2 GeV would deliver 11 nm into a
  // scanner that cannot see it. MEASURED first harmonic at a 6.0 mm gap:
  // 13.34, 13.40 and 13.45 nm — three different machines, one wavelength,
  // all three inside the mirror's window. Overshooting is not an upgrade: at
  // 1.19 GeV (one Nb3Sn sector in place of two CW ones, which also measures
  // in band) 13.5 nm would want a 4.5 mm undulator gap and the stop is 5.0.
  //
  // `pillboxCavity` is barred from this palette and its absence is felt in
  // every design here: there is no cheap transit-time fix ahead of the first
  // cryomodule, so the gun runs as stiff as the current target allows and
  // the CW sector eats whatever beta it is handed. At 1 GeV x 10 mA this
  // line is handling 10 MW continuously and copper would simply melt.
  {
    id: 'euvfel-pilot',
    typeId: 'euvFel',
    tier: 1,
    name: 'EUV Pilot Line (10 mA)',
    blurb: 'Ten milliamps of continuous beam into one undulator and a dump that costs more to run than the linac. Proves 13.5 nm to a fab that has not signed yet.',
    // MEASURED 996.3 MeV, 10.000 mA, q 1.00, loss 0.500 (capture only),
    // eps_n 2.18e-6 m-rad, final spot 0.38 x 2.69 mm, peak envelope 3.55 mm.
    // 13.34 nm at a 6.0 mm gap (K = 2.184).
    //
    // THE GUN IS AT ITS 250 kV END STOP AND THIS IS STILL THE HIGHEST-
    // VOLTAGE, LOWEST-CURRENT MACHINE OF THE THREE. The source makes
    // I = 5 kW / V, the first cryomodule captures 0.50, and 10.00 mA is the
    // floor of what this type can physically deliver — the bottom half of
    // its own 5-15 mA band is unreachable with the hardware that exists
    // (finding 3 in the header). Everything above here goes the other way:
    // turn the gun DOWN and sell the extra milliamps.
    //
    // No solenoid at the gun, and that is measured rather than assumed:
    // 0.005 T changes nothing, 0.02 T loses 40% of the beam and 0.05 T loses
    // all of it. A 250 kV beam is stiff enough to reach the first cryomodule
    // on its own, which is a large part of why the gun is run up there.
    //
    // 2.5 T/m on the matching doublet: k = 0.226 at 0.996 GeV. That is an
    // eighth of the catalogue default, and the default lands the beam on the
    // wall inside a metre.
    components: [
      { type: 'source', params: { extractionVoltage: 250, cathodeTemperature: 1200 } },
      { type: 'cwCryomodule', params: { rfPhase: 0 } },
      { type: 'cwCryomodule', params: { rfPhase: 0 } },
      { type: 'chicane', params: { r56: -50 } },
      { type: 'quadrupole', params: { gradient: 2.5, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 2.5, polarity: 1 } },
      { type: 'undulator', params: { gap: 6 } },
      { type: 'ict', params: {} },
      { type: 'bpm', params: {} },
      { type: 'beamStop', params: {} },
    ],
  },
  {
    id: 'euvfel-production',
    typeId: 'euvFel',
    tier: 2,
    name: 'EUV Production Line (12.5 mA)',
    blurb: 'A quarter more current, twice the undulator, and a recirculation arc that hands the spent beam back to the cavities instead of to a dump. The first one that survives its own electricity bill.',
    // MEASURED 994.2 MeV, 12.499 mA, q 1.00, loss 0.500 (capture only),
    // eps_n 2.28e-6 m-rad, final spot 1.14 x 1.72 mm, peak envelope 3.80 mm.
    // 13.40 nm at a 6.0 mm gap — 2 MeV of beam energy separates this machine
    // from the pilot line and it moves the photon by 0.06 nm, which is the
    // whole reason this type's band is the sharpest in the roster.
    //
    // The gun drops to 200 kV, where the constant-power source makes 25 mA
    // instead of 20 and the same 0.50 capture delivers 12.50 instead of
    // 10.00. The cost is a slightly softer beam into the first cryomodule
    // (beta 0.695 rather than 0.741) and a 5% wider normalised emittance.
    // Both are cheap; the milliamps are the product.
    //
    // The `recirculationArc` is the tier's real purchase and the reason
    // `energyRecovery` is one of this type's two research gates. It is
    // near-isochronous by construction — r56 -5 mm against the compressor's
    // -50 — so it returns the beam without undoing the bunch length it took
    // a chicane to make. It measures as 6 m of drift here, because the
    // engine has no representation of handing energy back to the RF; what it
    // buys is in the economy, not in the beam.
    //
    // Two doublets at 1.8 T/m rather than one at 2.5: more cells, so each
    // works less hard. k = 0.163, and the peak envelope stays at 3.80 mm
    // against the undulator's 8 mm half-aperture.
    components: [
      { type: 'source', params: { extractionVoltage: 200, cathodeTemperature: 1200 } },
      { type: 'cwCryomodule', params: { rfPhase: 0 } },
      { type: 'cwCryomodule', params: { rfPhase: 0 } },
      { type: 'chicane', params: { r56: -50 } },
      { type: 'quadrupole', params: { gradient: 1.8, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 1.8, polarity: 1 } },
      { type: 'undulator', params: { gap: 6 } },
      { type: 'quadrupole', params: { gradient: 1.8, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 1.8, polarity: 1 } },
      { type: 'undulator', params: { gap: 6 } },
      { type: 'ict', params: {} },
      { type: 'bpm', params: {} },
      { type: 'recirculationArc', params: { r56: -5 } },
      { type: 'beamStop', params: {} },
    ],
  },
  {
    id: 'euvfel-fab',
    typeId: 'euvFel',
    tier: 3,
    name: 'Fab Supply Line (14.7 mA)',
    blurb: 'Fifteen milliamps, three undulators and enough diagnostics to prove availability to a customer with penalty clauses. One product, one wavelength, and it is never allowed to stop.',
    // MEASURED 992.2 MeV, 14.705 mA, q 1.00, loss 0.500 (capture only),
    // eps_n 3.15e-6 m-rad, final spot 0.85 x 2.33 mm, peak envelope 4.01 mm.
    // 13.45 nm at a 6.0 mm gap — the closest of the three to the mirror's
    // 13.5, and it gets there by being the LOWEST-energy machine in the type.
    //
    // 170 kV on the gun: 29.4 mA before capture, 14.71 after, against a
    // 15.00 mA band ceiling — 165 kV would measure 15.15 and fail. This is
    // the top of the type, reached along the only axis the type has.
    //
    // THE BUNCHER IS DELIBERATELY ABSENT and it is the interesting choice
    // here. A 220 kV gun behind one lifts capture 0.50 -> 0.65 and measures
    // 14.77 mA, a hair MORE than this line makes. It also measures eps_n
    // 7.37e-6 against 3.15e-6, because a 162.5 MHz sub-harmonic bucket on a
    // 220 keV beam sits a long way off its design beta and every slice of
    // that mismatch grows the envelope. The diffraction limit at 13.5 nm is
    // eps_n = 2.1e-6: 3.15e-6 is a machine a fab will buy and 7.37e-6 is a
    // brochure. 0.07 mA is not worth 2.3x the phase space.
    //
    // Three doublets at 1.2 T/m (k = 0.109) and three undulators, plus a
    // wire scanner the pilot line could not justify. The emittance is 45%
    // wider than tier 1's purely because a 170 kV beam spends longer
    // sub-relativistic before the first cryomodule catches it — the price of
    // every milliamp on this ladder, stated once and paid three times.
    components: [
      { type: 'source', params: { extractionVoltage: 170, cathodeTemperature: 1200 } },
      { type: 'cwCryomodule', params: { rfPhase: 0 } },
      { type: 'cwCryomodule', params: { rfPhase: 0 } },
      { type: 'chicane', params: { r56: -50 } },
      { type: 'quadrupole', params: { gradient: 1.2, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 1.2, polarity: 1 } },
      { type: 'undulator', params: { gap: 6 } },
      { type: 'quadrupole', params: { gradient: 1.2, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 1.2, polarity: 1 } },
      { type: 'undulator', params: { gap: 6 } },
      { type: 'quadrupole', params: { gradient: 1.2, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 1.2, polarity: 1 } },
      { type: 'undulator', params: { gap: 6 } },
      { type: 'wireScanner', params: {} },
      { type: 'ict', params: {} },
      { type: 'bpm', params: {} },
      { type: 'recirculationArc', params: { r56: -5 } },
      { type: 'beamStop', params: {} },
    ],
  },
];
