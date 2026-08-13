// src/data/stock-designs/black-hole.js — Black Hole Factory (tier 6).
//
// See ../stock-designs.js for the entry shape and the authoring rules, and
// ./collider.js for the type one rung below, whose findings all recur here in
// exaggerated form.
//
// Every number below was MEASURED through the layoutDesign ->
// buildPhysicsElements -> beam_physics chain that scripts/eval-design.mjs
// runs. Two caveats on the readings, both structural:
//
//   * `blackHoleYield` is this type's `fom` and eval_design.py does not
//     forward it — SUMMARY_FIELDS carries `luminosity` but not the derived
//     yield. The per-second figures quoted below are gameplay.py's own
//     black_hole_yield() evaluated on the MEASURED energy and luminosity, and
//     the formula was checked against the type's fomRef note (250,000 GeV/beam
//     at 1e34 reproduces 1.8 events/s exactly). They are derived, not asserted,
//     but they do not come out of the harness.
//   * The IP luminosity here is REAL, unlike the collider's. `blackHoleChamber`
//     declares physicsType 'detector', which is what beam_beam.py fires on, so
//     the number the picker would show is the number the interaction region
//     actually produces. collider.js note 5 is fixed by construction on this
//     type.
//
// ── THE MAP ───────────────────────────────────────────────────────────────
//
// crystalChannelStage is subL 20, so n stages make a pipe of
// ceil((20n + (n+1)/2) / 4) tiles, plus the injector and the twelve sub-units
// of chamber. Measured against land.js, using the front ends shipped below:
//
//        stages    E (GeV)   tiles   smallest map that holds it
//         9        106,000     53    61   (the STARTING site)
//        10        118,000     58    61
//        11        130,000     66    121  (land1)
//        21        247,000    117    121
//        22        259,000    122    181  (land2)
//        33        389,000    179    181
//        34        401,000    184    241  (land3)
//        42        495,000    225    241
//        43        507,000    230    241  <- OUT OF BAND, high side
//        45        531,000    240    241
//        46        543,000    245    nothing on the ladder
//
// Three findings in that table, all of which matter to the land ladder:
//
//   1. THE BAND CAPS THE MACHINE BEFORE THE MAP DOES. 42 stages is 495 TeV and
//      225 tiles; the 43rd lands 507 TeV, straight out of the top of
//      spec.energyGeV, while the 241-tile site would hold 45. The largest LEGAL
//      machine leaves 16 tiles of land unused. Parcel 3 is genuinely required —
//      42 stages will not fit on 181 — but it is not the binding constraint,
//      and no further ground would buy another TeV.
//
//   2. THE ENTRY MACHINE FITS ON THE STARTING SITE. See the band-floor note
//      below; this is the one place where the type's stated identity and its
//      arithmetic disagree.
//
//   3. NOTHING NEEDS FOLDING. The concern in beamline-types.js about dipoles
//      and E^4/rho never arises: the straight run fits with room, and no
//      blueprint here was ever tempted to bend.
//
// The three shipped tiers land on three distinct map states — 61, 121, 241 —
// so the machine ladder and the land ladder step together. Parcel 2 (181) is
// deliberately not a stock rung: it holds 33 stages, 389 TeV, which is a
// machine the player builds themselves by extending the tier-2 line.
//
// ── ON THE 100 TeV BAND FLOOR: LEAVE IT ───────────────────────────────────
//
// The floor is 9 stages and 53 tiles, and a 61-tile site holds it with 8 tiles
// to spare, so "the machine you buy the map for" is not literally true at tier
// 1. Making it true costs 11 stages, i.e. a floor of 130,000 GeV/beam. The
// measured recommendation is DON'T, for three reasons in this order:
//
//   * 100,000 GeV/beam is 200 TeV in the centre of mass, and the type's own
//     comment derives that number from a 5 TeV fundamental scale — it is a
//     physics threshold, not a round number. Raising it to 260 TeV to fix a
//     land-progression feeling moves a physics statement to solve a UX
//     problem.
//   * The tier-1 gate is already real and it is money. $12.12B of hardware,
//     behind `colliderTech` (which is itself downstream of having built the
//     entire linear collider) and `particleDiscovery`. Land parcels 1 and 2
//     cost $500M and $3B; anybody who can pay for this machine bought them
//     long ago for the collider. The bare-61-tile case is reachable on paper
//     and essentially never reached in play.
//   * It is only 8 tiles. If the identity must bite at tier 1, buy it on the
//     land side — a clearance or shielding standoff around the interaction
//     region would push 53 past 61 without touching the spec band, and would
//     also be true of the real thing.
//
//   For the record, if it is raised anyway: 130,000 is the right number (11
//   stages, 66 tiles, the first length that needs parcel 1) and it costs 6% of
//   the yield, since yield goes as E^(2/7). Nothing else in the file changes.
//
// ── WHY cyclotron70, AND WHY THE OBVIOUS FRONT ENDS ARE ALL WRONG ─────────
//
// This type's own sources are `ionSource` and `ecrIonSource`, both DC, both
// extracting at 10-100 kV. Neither can start this machine, and the finding is
// worth keeping because it is not obvious from the palette:
//
// A 40 keV proton is beta 0.0092. DEFAULT_SOURCE in beam_physics/constants.py
// gives it 1e-6 m.rad normalized, i.e. 1.08e-4 m.rad GEOMETRIC, and a 33 mm
// sigma inside the ion source's own 32 mm bore. crystalChannelStage's bore is
// 4 mm over a 10 m body — an acceptance of order 1.6e-6 m.rad, sixty-eight
// times too small — and 50 mA of DC beam at that beta is a space-charge
// problem before it is an optics problem. Measured:
//
//   ionSource straight into the chamber      4.1 uA of 50 mA, peak sigma 527 mm
//   ionSource + 9 crystal stages             105.6 TeV, loss 1.000, 9.2e-15 uA
//   + solenoid scan, 0.001 - 0.5 T           loss 1.000 at every point
//   + 100 kV extraction, 1 A arc             loss 1.000, L 5.5e+1 cm^-2 s^-1
//   + buncher, 20x and 60x pillboxCavity     loss 1.000, peak sigma 212 m
//   ecrIonSource, every knob                 loss 1.000
//
// The energy was never the problem — the crystal ladder delivers 11.8 TeV a
// stage and the beam comes out at 105.6 TeV. The BEAM is the problem: against
// the 1.4e+25 a shipped blueprint below reaches, the best of that scan is
// twenty-three orders of magnitude short. This is proton.js's "NO BUILT-UP
// PROTON LINAC TRANSPORTS" finding restated for a type that does not even have
// the rfq, and no optic fixes an acceptance mismatch.
//
// THE COLLIDER'S LADDER DOES NOT RESCUE IT EITHER, which is worth stating so
// nobody spends an afternoon finding out. srfLinacSector, twoBeamModule and
// plasmaAfterburner all carry DESIGN_BETA 0.999 in
// beam_physics/modules/rf_acceleration.py — beta=1 electron hardware — so
// against a 40 keV proton the transit-time factor floors at 0.01 and a 3.5 GeV
// sector delivers 35 MeV over 16 m of bore. Measured: 1, 3 and 10 sectors all
// give loss 1.000 at peak sigma 2.2 / 2.1 / 1.7 m.
//
// What the type needed was not more gradient. It was a hadron front end that
// hands over a beam already at tens of MeV — the same job positronSource does
// for the collider — and `cyclotron70` and `cyclotron230` were allowlisted here
// for that. Between the two it is not close:
//
//                    I out     eps    loss over 42 stages   L          yield/s
//   cyclotron230     0.5 uA    5      0.500 (capture only)  8.5e+18    1.9e-15
//   cyclotron70      456 uA    8      0.392 (see below)     1.4e+25    3.1e-9
//
// cyclotron230 has the better beam and is dominated by six orders of magnitude
// anyway, because luminosity goes as N^2 and it delivers a seven-hundred-and-
// fiftieth of the current. Its 1.6x emittance advantage is worth 3.1x of spot
// area against a 562,500x deficit in charge. It gets no blueprint. It is still
// the right component to have allowlisted — it is the machine a player reaches
// for when they want the clean beam and have not yet worked out that on this
// type nothing is paid for cleanliness.
//
// ── THE FRONT END *IS* THE MACHINE, AND IT COSTS $750,000 ─────────────────
//
// The single largest effect measured anywhere on this type, and the axis the
// three tiers are built on. Same cyclotron, same nine crystal stages, same
// 105.8 TeV, three front ends:
//
//   naked                          279 uA   loss 0.628   spot 14.86 x 14.86 mm
//                                  L 8.4e+23    yield 1.20e-10 /s
//   + matching triplet             355 uA   loss 0.527   spot  3.19 x  8.37 mm
//                                  L 1.1e+25    yield 1.61e-9  /s
//   + buncher, then the triplet    451 uA   loss 0.398   spot  2.90 x  8.58 mm
//                                  L 2.0e+25    yield 2.79e-9  /s
//
// A factor of TWENTY-THREE in the number this type is scored on, for $750,000
// of hardware on a $12,000,000,000 machine. Two separate mechanisms, and they
// are the collider's findings 1 and 2 with the signs reversed:
//
//   CAPTURE. Whatever accelerates first sets the bunch structure and keeps a
//   fixed fraction of the beam forever (CAPTURE_EFFICIENCY in
//   rf_acceleration.py). crystalChannelStage has no entry there and takes the
//   0.50 default; `buncher` takes 0.65. Putting the $150k buncher in front of
//   $18.9B of crystal is worth 30% of the current and 69% of the luminosity,
//   permanently. It also stamps 162.5 MHz instead of the 1.3 GHz default,
//   which is fewer and fatter bunches — and L goes as N^2 f, with N going as
//   1/f, so a lower repetition frequency is worth its ratio in luminosity too.
//
//   MATCHING AT THE FRONT, WHERE THE BEAM IS STILL SOFT. This is the collider's
//   final-focus problem turned inside out. At the IP nothing can be done: k =
//   0.2998 g / p at 500 TeV is 1.5e-5 m^-2, a 67 km focal length on a 1 m
//   magnet, and finalFocusDoublet and scQuad are collider-allowlisted anyway.
//   At the cyclotron exit the beam is 70 MeV and p = 0.369 GeV/c, where an
//   ordinary $200k quadrupole is a real lens — and adiabatic damping then LOCKS
//   IN whatever spot the triplet made, unchanged, for the whole 225 tiles. So
//   the interaction region of this machine is designed at the injector.
//
//   The same triplet is also what stops the beam decaying. Unmatched, the
//   naked line scrapes 3.1% per stage on the 4 mm bores — 279 uA at 9 stages
//   and 97 uA at 42, a factor of three thrown away over the length of the
//   machine. Matched, the envelope is flat: 451 uA at 9 stages and 456 at 42,
//   loss 0.392 against a capture floor of 0.35. Nothing scrapes anywhere.
//
//   THE TRIPLET IS A TUNED VALUE, NOT A FLOOR. Symmetric g/2g/g scan at nine
//   stages, yield per second: 1.4 -> 5.2e-10, 1.6 -> 8.6e-10, 1.8 -> 1.49e-9,
//   2.0 -> 1.09e-9, 2.4 -> 3.8e-10, and 2.6 falls off a cliff to 1.5e-11.
//   The shipped 2.0/3.6/1.6 came out of walking off that peak asymmetrically
//   and is worth another 15%. ORDER MATTERS TOO: buncher-then-triplet measures
//   2.79e-9 and triplet-then-buncher 6.5e-10, because the buncher's
//   transit-time mismatch kicks the transverse planes and undoes the match.
//
// ── ENERGY IS NOT THE LADDER, AND THAT IS THE TYPE'S REAL SHAPE ───────────
//
// Yield is sigma(E) x L; sigma is the geometric Dimopoulos-Landsberg disc and
// with six extra dimensions r_s goes as the SEVENTH ROOT of sqrt(s). Measured
// across the shipped tiers, holding the front end fixed: 4.7x the energy — 33
// more crystal stages, 108 more tiles, three land parcels and $29.7B — buys
// 1.25x the yield. The $750k front end buys 23x. gameplay.py's comment on
// EXTRA_DIMENSIONS predicts exactly this ("bought for luminosity and not for
// the last 100 TeV") and the measurement agrees.
//
// So the three tiers below are: the cheapest thing that is in band, the same
// machine with a front end, and the same front end with reach. The middle step
// is where the physics is; the top step is where the monument is.
//
// ── THE fom REFERENCE IS TEN ORDERS OUT ───────────────────────────────────
//
// beamline-types.js sets fomRef 1.8 events/s from "250,000 GeV/beam at 1e34
// cm^-2 s^-1". The energy is right — the tier-2 machine below sits at 247 TeV,
// almost exactly on it — but no buildable blueprint gets within ten orders of
// 1e34. The best measured luminosity on this type is 2.0e+25, and the reason
// is the IP spot: 3-9 mm, where a real hadron collider runs 16 um, and there
// is no final-focus hardware in the palette to close that (see above). Every
// shipped machine therefore scores ~1e-9 against a reference of 1.8. fomRef is
// already marked PROVISIONAL; it needs re-measuring against these numbers in
// scripts/balance-sim.mjs, or the type needs a final focus it can build.
//
// ── TWO THINGS FOUND ON THE WAY ───────────────────────────────────────────
//
//   hawkingDetector HAS NO LEGAL POSITION IN ANY BEAMLINE. It is role
//   'junction', routing [], and its only port is `entry` — so
//   flattener.pickOutgoingPort dead ends on it and the beam stops. Put it
//   before the chamber and the machine the player gets ends there; put it after
//   and there is no port to reach it through; put it last and requiredEndpoint
//   rejects the design. It also declares physicsType 'detector', so an inline
//   one would hijack the beam_beam report gameplay.py reads for blackHoleYield
//   (`bb_reports[0]`) from a point upstream of the interaction region. Nothing
//   here uses it; every blueprint below ends on blackHoleChamber.
//
//   THE PRICE IS PAST THE LAND LADDER. Tier 3 is $37.8B of crystal alone and
//   $41.82B all in, against a land ladder topping out at $18.5B and a late-game
//   research node at $41M. crystalChannelStage's own comment already flags this
//   for balance-sim.mjs; the measurement confirms the top machine costs more
//   than twice every acre in the game.

export const BLACK_HOLE_DESIGNS = [
  {
    id: 'blackhole-threshold',
    typeId: 'blackHoleFactory',
    tier: 1,
    name: 'Threshold Machine (100 TeV)',
    blurb: 'Nine crystals, a second-hand medical cyclotron, and the lowest centre-of-mass energy at which the cross-section is not identically zero. It fits on the land you already own, which is the last kind thing anybody will say about it.',
    // MEASURED 105.80 TeV, 279.3 uA, q 1.00, loss 0.628.
    // IP spot 14.86 x 14.86 mm, L 8.44e+23 cm^-2 s^-1, yield 1.20e-10 /s.
    // 10 placements, 53 tiles, mapHalfExtent 30 (the starting site), $12.12B.
    //
    // Nine stages because eight measures 94.0 TeV and falls out of the bottom
    // of the band. This is the floor of the type expressed as hardware.
    //
    // NO INJECTION FRONT END, and that is the tier rather than an oversight —
    // the whole content of tier 2 is the $750k that goes in front of the first
    // crystal. Left naked this machine scrapes 3.1% of its beam per stage on
    // the 4 mm bores and hands the chamber a 15 mm round spot; nine stages is
    // short enough that it survives that (279 uA of the 375 it captured) and
    // long enough to be in band. Extend this line without matching it first
    // and the attrition compounds: the same lattice at 42 stages measures
    // 97 uA and a fifth of the yield.
    components: [
      { type: 'cyclotron70', params: { particleType: 'proton' } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      // Same argument as the collider's: intra-train feedback steers one beam
      // onto the other from this reading, and a collider that cannot see its
      // own orbit at the last metre is not in collision.
      { type: 'bpm', params: {} },
      { type: 'blackHoleChamber', params: {} },
    ],
  },
  {
    id: 'blackhole-quarter-pev',
    typeId: 'blackHoleFactory',
    tier: 2,
    name: 'Quarter-PeV Factory',
    blurb: 'Half a PeV in the centre of mass, and a buncher and three quadrupoles that are worth more science than the twelve extra crystals behind them. This is the machine the type was designed around: if there are extra dimensions, this is what finds them.',
    // MEASURED 247.40 TeV, 456.4 uA, q 1.00, loss 0.392 (capture 0.35 + 4%).
    // IP spot 4.15 x 8.78 mm, L 1.37e+25 cm^-2 s^-1, yield 2.48e-9 /s.
    // 26 placements, 117 tiles, mapHalfExtent 60 (parcel 1), $22.92B.
    //
    // 494 GeV in the centre of mass — 247 TeV a beam, which is where
    // beamline-types.js puts its own reference machine, and it is not a
    // coincidence: this is the rung the type is balanced against.
    //
    // TWENTY-THREE TIMES THE YIELD OF TIER 1 FOR $800k AND TWELVE CRYSTALS,
    // and the twelve crystals are the cheap part of that sentence. The buncher
    // captures 0.65 where the crystal stage takes the 0.50 default, and stamps
    // 162.5 MHz instead of 1.3 GHz; the triplet matches the 70 MeV beam into
    // the 4 mm bore, which both stops the per-stage scraping dead and sets the
    // IP spot for the entire length of the machine, because adiabatic damping
    // preserves whatever waist the injector made.
    //
    // The gradients are tuned values and the peak is sharp — 1.8/3.6/1.8
    // measures 1.49e-9 at nine stages, 2.6/5.2/2.6 measures 1.5e-11. Do not
    // read them as a floor and do not scale them with the beam energy: they
    // are matched to the CYCLOTRON's 0.369 GeV/c, not to the 247 TeV
    // downstream, and every crystal stage after the first is past the point
    // where any quadrupole in this catalogue can do anything at all.
    //
    // Order is load-bearing. Buncher first, then the triplet: reversed, the
    // buncher's transit-time mismatch kicks the transverse planes and the
    // match is thrown away, for a measured 6.5e-10 against 2.79e-9.
    components: [
      { type: 'cyclotron70', params: { particleType: 'proton' } },
      // Bunching only — rfPhase -90 is on the zero crossing, so this adds no
      // energy. What it buys is capture, and capture is forever.
      { type: 'buncher', params: { voltage: 0.1, rfPhase: -90 } },
      { type: 'quadrupole', params: { gradient: 2.0, polarity: 1 } },
      { type: 'quadrupole', params: { gradient: 3.6, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 1.6, polarity: 1 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'bpm', params: {} },
      { type: 'blackHoleChamber', params: {} },
    ],
  },
  {
    id: 'blackhole-pev',
    typeId: 'blackHoleFactory',
    tier: 3,
    name: 'PeV Collider (Site Condemnation Class)',
    blurb: 'Forty-two channeling stages, two hundred and twenty-five tiles dead straight, and every acre the county could be made to sell. Four times the energy of the machine below it for a quarter more events — you are not buying yield up here, you are buying the right to say you looked.',
    // MEASURED 495.30 TeV, 456.1 uA, q 1.00, loss 0.392 (capture 0.35 + 4%).
    // IP spot 4.07 x 8.77 mm, L 1.39e+25 cm^-2 s^-1, yield 3.09e-9 /s.
    // 47 placements, 225 tiles, mapHalfExtent 120 (parcel 3), $41.82B.
    //
    // 991 GeV in the centre of mass, 99% of the type's ceiling, and the reason
    // land parcel 3 exists. Forty-three stages measures 507 TeV and is out of
    // band; the site would hold forty-five. The band is the wall here, not the
    // ground.
    //
    // IDENTICAL FRONT END TO TIER 2, DELIBERATELY. That is what the tier step
    // is: twenty-one more crystal stages, 108 more tiles, two more land
    // parcels, $18.9B — and a yield of 3.09e-9 against 2.48e-9, a gain of 25%.
    // Yield goes as the seventh root of sqrt(s), so this is what the top of
    // the band costs and what it is worth, measured rather than argued.
    //
    // The one thing it proves is that the matching holds. 456.1 uA out of the
    // forty-second stage against 456.4 out of the twenty-first: over 225 tiles
    // and 42 four-millimetre bores, nothing scrapes. The unmatched version of
    // this same line measures 97.4 uA and 2.28e-11 — a factor of 135 in yield,
    // still bought with the same $750k of front end.
    components: [
      { type: 'cyclotron70', params: { particleType: 'proton' } },
      { type: 'buncher', params: { voltage: 0.1, rfPhase: -90 } },
      { type: 'quadrupole', params: { gradient: 2.0, polarity: 1 } },
      { type: 'quadrupole', params: { gradient: 3.6, polarity: 0 } },
      { type: 'quadrupole', params: { gradient: 1.6, polarity: 1 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'crystalChannelStage', params: { rfPhase: 0 } },
      { type: 'bpm', params: {} },
      { type: 'blackHoleChamber', params: {} },
    ],
  },
];
